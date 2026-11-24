/**
 * Terrain height model (spec `relief:`, README "Relief"). Pure and deterministic: same spec +
 * same street graph -> identical heights. Heights are meters above sea level (spec z); `x`, `y`
 * are spec meters (east, north). Scene conversion is `specToScene(p, height)`, nothing else.
 *
 *   base height = coastal ramp (or sea floor) + (1 - hill mask) * rolling noise
 *                 + smooth-max(p = 4) of [sum of hill masks * (uplift + hill noise)] and [ridges]
 *                 + upland (outside the active rect only)
 *                 -> flatten zones (level / cap) -> landmark pads
 *   Layer 2 (whole isthmus): the base surface is also baked on the far grid (relief.grid.far.cell,
 *   origin (0, 0)); the active rect keeps the fine grid and blends into the far grid over the last
 *   half of its margin, so queries never step.
 *   Layer 3 (rivers, canal, Gatún Lake, locks) is added on top as a height change (`carve`, same grids);
 *   it is dropped under street carriageways, so an existing street crosses a river on its own level.
 *   final height = base height graded toward every street centerline (no cross-slope, grade
 *                  limited by relief.streets.max_grade); baked on a regular grid, bilinear queries.
 */
import type { Vec2 } from './vec.ts';
import type { Rect } from './geometry.ts';
import type { FlattenZone, HillFeature, NoiseSpec, RidgeFeature, WorldSpec } from './spec.ts';
import type { GraphSnapshot } from './streets/planar-graph.ts';
import type { Layer2Output } from './layers/layer2-relief.ts';
import type { Layer3Output } from './layers/layer3-water.ts';

export interface HeightGrid {
  /** Spec x / y of sample (0, 0), meters. */
  x0: number;
  y0: number;
  cell: number;
  /** Samples along x (east) and y (north). */
  cols: number;
  rows: number;
  /** data[j * cols + i] is the height at (x0 + i * cell, y0 + j * cell). */
  data: Float32Array;
}

/** Axis-aligned footprint, as the greybox buildings carry it. */
export interface Footprint {
  center: Vec2;
  width: number;
  depth: number;
  angle: number;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  if (e1 <= e0) return x >= e1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x1b873593) ^ Math.imul(iy | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const GRAD_COS = new Float64Array(256);
const GRAD_SIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  GRAD_COS[i] = Math.cos((i / 256) * Math.PI * 2);
  GRAD_SIN[i] = Math.sin((i / 256) * Math.PI * 2);
}

/** Perlin gradient noise, roughly in [-0.7, 0.7]. */
export function perlin(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const g = (cx: number, cy: number, dx: number, dy: number): number => {
    const k = (hash2(cx, cy, seed) * 256) | 0;
    return (GRAD_COS[k] as number) * dx + (GRAD_SIN[k] as number) * dy;
  };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = g(ix, iy, fx, fy);
  const n10 = g(ix + 1, iy, fx - 1, fy);
  const n01 = g(ix, iy + 1, fx, fy - 1);
  const n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const top = n00 + u * (n10 - n00);
  const bottom = n01 + u * (n11 - n01);
  return top + v * (bottom - top);
}

/** Fractal noise: octave i has wavelength / 2^i and amplitude * persistence^i. */
export function fbm(x: number, y: number, n: NoiseSpec, seed: number): number {
  let sum = 0;
  let amp = n.amplitude;
  let freq = 1 / n.wavelength;
  for (let i = 0; i < n.octaves; i++) {
    sum += amp * perlin(x * freq + i * 37.7, y * freq - i * 21.3, seed + i * 101);
    amp *= n.persistence;
    freq *= 2;
  }
  return sum;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRing(px: number, py: number, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToRect(x: number, y: number, r: FlattenZone['rect']): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dy = Math.max(r.minY - y, 0, y - r.maxY);
  return Math.hypot(dx, dy);
}

/** Roads are designed to this share of max_grade; the rest absorbs the baked grid's blending. */
const GRADE_MARGIN = 0.6;

interface Pad {
  x: number;
  y: number;
  level: number;
}

/** Result of relaxing street node heights, exposed for tests and tools. */
export interface StreetGrading {
  /** Graded height of every street node, by node id (NaN for frame-only nodes). */
  nodeHeight: Float64Array;
  /** Street edges whose grade could not be brought under the limit (should be 0). */
  unresolved: number;
  /** Relaxation sweeps used. */
  sweeps: number;
}

const RIDGE_NOISE_GAIN = 0.3;
const RIDGE_NOISE_WAVELENGTH = 700;
const SMAX_P = 4;
/** m: within this distance of the shore the signed distance is exact, not interpolated. */
const NEAR_SHORE = 100;

export class Terrain {
  readonly spec: WorldSpec;
  /** The active rect the fine grid was built for. */
  readonly rect: Rect;
  readonly grid: HeightGrid;
  private farBaked: HeightGrid | undefined;
  private readonly farNodes = new Map<number, number>();
  /** The base surface (no street grading) baked on the same grid. */
  readonly baseGrid: HeightGrid;
  readonly grading: StreetGrading;
  private readonly zoneLevels: number[];
  private readonly pads: Pad[];
  private readonly coast: HeightGrid;
  private readonly coastRing: readonly Vec2[];
  private readonly coastEdges: readonly [Vec2, Vec2][];
  /** H0 + layer 3 carve on the far grid (only with layer 3); what `heightAt` reads outside the fine grid. */
  private surfaceFar: HeightGrid | undefined;

  /**
   * `layers.layer2` reuses an already baked H0 (same rect) instead of baking it again; `layers.layer3` adds
   * the water layer's carve on top. `farGrid` and `baseGrid` stay H0 (layer 2's output) either way.
   */
  constructor(spec: WorldSpec, rect: Rect, graph?: GraphSnapshot, layers?: { layer2?: Layer2Output; layer3?: Layer3Output }) {
    this.spec = spec;
    this.rect = rect;
    const rel = spec.relief;
    this.coastRing = spec.land;
    const edges: [Vec2, Vec2][] = [];
    for (let i = 0; i < spec.land.length; i++) edges.push([spec.land[i] as Vec2, spec.land[(i + 1) % spec.land.length] as Vec2]);
    // The map's west/east/north land edges are the bounds box, not a shore.
    const { width, height } = spec.bounds;
    this.coastEdges = edges.filter(([a, b]) => !((a.x === b.x && (a.x === 0 || a.x === width)) || (a.y === b.y && (a.y === 0 || a.y === height))));

    const cell = rel.grid.cell;
    const x0 = Math.floor((rect.minX - rel.grid.margin) / cell) * cell;
    const y0 = Math.floor((rect.minY - rel.grid.margin) / cell) * cell;
    const cols = Math.ceil((rect.maxX + rel.grid.margin - x0) / cell) + 1;
    const rows = Math.ceil((rect.maxY + rel.grid.margin - y0) / cell) + 1;

    // Coarse signed shore distance (smooth, so bilinear is exact enough); one pass, reused by every sample.
    // Covers the whole isthmus plus COAST_PAD m; its lattice (multiples of 40 m) contains the fine grid's
    // coarse samples, so values inside the active area are the same as when it covered only the rect.
    const cc = 40;
    const COAST_PAD = 400;
    const cx0 = -COAST_PAD;
    const cy0 = -COAST_PAD;
    const ccols = Math.ceil((width + 2 * COAST_PAD) / cc) + 2;
    const crows = Math.ceil((height + 2 * COAST_PAD) / cc) + 2;
    const cdata = new Float32Array(ccols * crows);
    for (let j = 0; j < crows; j++) for (let i = 0; i < ccols; i++) cdata[j * ccols + i] = this.exactCoast(cx0 + i * cc, cy0 + j * cc);
    this.coast = { x0: cx0, y0: cy0, cell: cc, cols: ccols, rows: crows, data: cdata };

    this.zoneLevels = [];
    this.pads = [];
    // Zone levels first (they only need the surface without zones), then pads (they need the zones).
    rel.flatten.forEach((z, i) => {
      if (z.level === 'auto') this.zoneLevels[i] = this.meanOver(z.rect);
      else this.zoneLevels[i] = typeof z.level === 'number' ? z.level : NaN;
    });
    const a = spec.activeArea;
    for (const l of spec.landmarks) {
      if (l.onWater) continue;
      if (l.position.x < a.x[0] || l.position.x > a.x[1] || l.position.y < a.y[0] || l.position.y > a.y[1]) continue;
      this.pads.push({ x: l.position.x, y: l.position.y, level: this.zonesOnly(l.position.x, l.position.y) });
    }

    const bake2 = (fn: (x: number, y: number) => number): HeightGrid => {
      const cc2 = Math.ceil(cols / 2) + 1;
      const cr2 = Math.ceil(rows / 2) + 1;
      const lo = new Float32Array(cc2 * cr2);
      for (let j = 0; j < cr2; j++) for (let i = 0; i < cc2; i++) lo[j * cc2 + i] = fn(x0 + i * 2 * cell, y0 + j * 2 * cell);
      const data = new Float32Array(cols * rows);
      const lg: HeightGrid = { x0, y0, cell: 2 * cell, cols: cc2, rows: cr2, data: lo };
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) data[j * cols + i] = sample(lg, i / 2, j / 2);
      return { x0, y0, cell, cols, rows, data };
    };
    // The base surface is smooth at the cell scale (finest feature ~95 m, pad/zone blends >= 45 m):
    // evaluate it every other sample and interpolate, a 4x cut of the noise cost.
    const l2 = layers?.layer2;
    const reuse = l2 !== undefined && l2.fine.x0 === x0 && l2.fine.y0 === y0 && l2.fine.cell === cell && l2.fine.cols === cols && l2.fine.rows === rows;
    if (reuse) {
      this.baseGrid = l2.fine;
      this.farBaked = l2.far;
    } else {
      this.baseGrid = bake2((x, y) => this.baseHeightAt(x, y));
    }
    let surfaceBase = this.baseGrid;
    const l3 = layers?.layer3;
    if (l3) {
      const fg = this.farGrid;
      const cf = l3.carve.far;
      const fdata = new Float32Array(fg.data.length);
      for (let k = 0; k < fdata.length; k++) fdata[k] = (fg.data[k] as number) + (cf.data[k] as number);
      this.surfaceFar = { ...fg, data: fdata };
      surfaceBase = this.carvedBase(this.baseGrid, l3.carve.fine, graph);
    }
    const graded = graph ? this.gradeStreets(graph, surfaceBase) : undefined;
    this.grid = this.blendIntoFar(graded?.grid ?? surfaceBase, rel.grid.margin / 2);
    this.grading = graded?.grading ?? { nodeHeight: new Float64Array(0), unresolved: 0, sweeps: 0 };
  }

  /**
   * The base surface (no street grading) on the whole isthmus: nodes every relief.grid.far.cell m
   * from (0, 0) to the bounds. Baked on first use (about a quarter of a second), so a build that
   * only needs the active area does not pay for it.
   */
  get farGrid(): HeightGrid {
    if (!this.farBaked) {
      const fc = this.spec.relief.grid.far.cell;
      const cols = Math.round(this.spec.bounds.width / fc) + 1;
      const rows = Math.round(this.spec.bounds.height / fc) + 1;
      const data = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) data[j * cols + i] = this.farNode(i, j);
      this.farBaked = { x0: 0, y0: 0, cell: fc, cols, rows, data };
    }
    return this.farBaked;
  }

  private farNode(i: number, j: number): number {
    const fc = this.spec.relief.grid.far.cell;
    const cols = Math.round(this.spec.bounds.width / fc) + 1;
    const k = j * cols + i;
    let v = this.farNodes.get(k);
    if (v === undefined) {
      v = Math.fround(this.baseHeightAt(i * fc, j * fc));
      this.farNodes.set(k, v);
    }
    return v;
  }

  /** Far-grid height at (x, y), clamped to the map bounds; same values as `farGrid`, without baking it all. */
  private farSample(x: number, y: number): number {
    if (this.surfaceFar) {
      const sf = this.surfaceFar;
      return sample(sf, ...clampTo(sf, x, y));
    }
    const fc = this.spec.relief.grid.far.cell;
    const cols = Math.round(this.spec.bounds.width / fc) + 1;
    const rows = Math.round(this.spec.bounds.height / fc) + 1;
    const fx = Math.min(cols - 1, Math.max(0, x / fc));
    const fy = Math.min(rows - 1, Math.max(0, y / fc));
    const i = Math.min(cols - 2, Math.floor(fx));
    const j = Math.min(rows - 2, Math.floor(fy));
    const tx = fx - i;
    const ty = fy - j;
    const a = this.farNode(i, j) * (1 - tx) + this.farNode(i + 1, j) * tx;
    const b = this.farNode(i, j + 1) * (1 - tx) + this.farNode(i + 1, j + 1) * tx;
    return a * (1 - ty) + b * ty;
  }

  // ---- shore ------------------------------------------------------------------------------

  private exactCoast(x: number, y: number): number {
    let d = Infinity;
    for (const [a, b] of this.coastEdges) d = Math.min(d, distToSegment(x, y, a.x, a.y, b.x, b.y));
    // Land continues past the bounds box on its west / east / north edges: classify the clamped point.
    const cx = Math.min(this.spec.bounds.width - 0.01, Math.max(0.01, x));
    const cy = Math.min(this.spec.bounds.height - 0.01, Math.max(0.01, y));
    return insideRing(cx, cy, this.coastRing) ? d : -d;
  }

  /** Signed distance (m) to the shoreline, positive on land. */
  coastDistance(x: number, y: number): number {
    const c = this.coast;
    const fx = (x - c.x0) / c.cell;
    const fy = (y - c.y0) / c.cell;
    if (fx < 0 || fy < 0 || fx > c.cols - 1 || fy > c.rows - 1) return this.exactCoast(x, y);
    const d = sample(c, fx, fy);
    // The 40 m grid cuts the shoreline's corners (error up to a few m of distance, i.e. up to a meter of
    // sea floor): near the shore blend to the exact distance, so the shoreline sits at height 0 everywhere.
    const w = smoothstep(NEAR_SHORE - 20, NEAR_SHORE + 20, Math.abs(d));
    return w >= 1 ? d : this.exactCoast(x, y) * (1 - w) + d * w;
  }

  // ---- base surface -----------------------------------------------------------------------

  private hillMask(h: HillFeature, x: number, y: number): number {
    return 1 - smoothstep(h.coreRadius, h.radius, Math.hypot(x - h.at.x, y - h.at.y));
  }

  /** Sum of hill masks, clamped to 1: where the rolling noise is replaced by hill noise. */
  hillWeight(x: number, y: number): number {
    let m = 0;
    for (const h of this.spec.relief.hills) m = Math.max(m, this.hillMask(h, x, y));
    return m;
  }

  private naturalAt(x: number, y: number): number {
    const rel = this.spec.relief;
    const d = this.coastDistance(x, y);
    if (d <= 0) return Math.max(rel.seaFloor.minHeight, rel.seaFloor.slope * d);
    const floor = rel.landFloor;
    const taper = smoothstep(0, rel.coastalRamp.noiseTaper, d);
    let h = Math.min(rel.coastalRamp.maxHeight, rel.coastalRamp.slope * d);
    const hw = this.hillWeight(x, y);
    h += (1 - hw) * fbm(x, y, rel.rolling, rel.seed) * taper;
    let hillTerm = 0;
    for (const hill of rel.hills) {
      const m = this.hillMask(hill, x, y);
      if (m > 0) hillTerm += m * (hill.uplift + fbm(x, y, hill.noise, rel.seed + 7) * taper);
    }
    // Ridges merge with the hills by smooth-max (p-norm): where no ridge reaches, the hills are untouched.
    const ridge = this.ridgeTerm(x, y) * taper * smoothstep(0, rel.upland.ridgeRectBlend, distToRect(x, y, this.rect));
    if (ridge > 0) {
      const a = Math.max(hillTerm, 0);
      hillTerm += Math.pow(Math.pow(a, SMAX_P) + Math.pow(ridge, SMAX_P), 1 / SMAX_P) - a;
    }
    h += hillTerm;
    const up = rel.upland;
    if (up.height > 0) {
      const w = smoothstep(0, up.rectBlend, distToRect(x, y, this.rect)) * smoothstep(0, up.coastBlend, d);
      if (w > 0) h += w * (up.height + fbm(x, y, up.noise, rel.seed + 13));
    }
    return softMax(h, floor * taper, 1);
  }

  /** Height of the highest ridge at (x, y): Gaussian on the distance to the crest, varied along the crest. */
  private ridgeTerm(x: number, y: number): number {
    const rel = this.spec.relief;
    let best = 0;
    for (let r = 0; r < rel.ridges.length; r++) {
      const ridge = rel.ridges[r] as RidgeFeature;
      let d = Infinity;
      let arc = 0;
      let run = 0;
      for (let i = 0; i + 1 < ridge.points.length; i++) {
        const a = ridge.points[i] as Vec2;
        const b = ridge.points[i + 1] as Vec2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy);
        const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (l * l)));
        const dist = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
        if (dist < d) {
          d = dist;
          arc = run + t * l;
        }
        run += l;
      }
      const s = d / ridge.width;
      if (s > 3) continue;
      const along = 1 + RIDGE_NOISE_GAIN * perlin(arc / RIDGE_NOISE_WAVELENGTH + r * 17.3, 0.5 + r * 3.1, rel.seed + 29);
      best = Math.max(best, ridge.amplitude * along * Math.exp(-s * s));
    }
    return best;
  }

  private meanOver(r: FlattenZone['rect']): number {
    let sum = 0;
    let n = 0;
    const step = 40;
    for (let y = r.minY; y <= r.maxY; y += step) {
      for (let x = r.minX; x <= r.maxX; x += step) {
        sum += this.naturalAt(x, y);
        n++;
      }
    }
    return sum / n;
  }

  private zonesOnly(x: number, y: number): number {
    let h = this.naturalAt(x, y);
    this.spec.relief.flatten.forEach((z, i) => {
      const w = 1 - smoothstep(0, z.blend, distToRect(x, y, z.rect));
      if (w <= 0) return;
      if (z.cap !== undefined) h += w * (softMin(h, z.cap, 1) - h);
      else h += w * ((this.zoneLevels[i] as number) - h);
    });
    return h;
  }

  /** Terrain height before street grading. */
  baseHeightAt(x: number, y: number): number {
    let h = this.zonesOnly(x, y);
    const { radius, blend } = this.spec.relief.landmarkPads;
    for (const p of this.pads) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d >= radius + blend) continue;
      h += (1 - smoothstep(radius, radius + blend, d)) * (p.level - h);
    }
    return h;
  }

  // ---- queries ----------------------------------------------------------------------------

  /**
   * Ground height (m) at spec (x, y): the finest grid covering the point (fine grid in the active
   * rect + margin, far grid over the rest of the isthmus); the edge value beyond the map bounds.
   */
  heightAt(x: number, y: number): number {
    const g = this.grid;
    let fx = (x - g.x0) / g.cell;
    let fy = (y - g.y0) / g.cell;
    if (fx >= 0 && fy >= 0 && fx <= g.cols - 1 && fy <= g.rows - 1) return sample(g, fx, fy);
    // Beyond the map bounds the edge value continues (the fine grid's margin blends into the same).
    const far = this.surfaceFar ?? this.farGrid;
    return sample(far, ...clampTo(far, x, y));
  }

  /** Cell (m) of the finest grid covering (x, y). */
  cellAt(x: number, y: number): number {
    const g = this.grid;
    const inside = x >= g.x0 && y >= g.y0 && x <= g.x0 + (g.cols - 1) * g.cell && y <= g.y0 + (g.rows - 1) * g.cell;
    return inside ? g.cell : this.farGrid.cell;
  }

  /** Ground normal in spec axes: x east, y north, z up. Unit length. */
  normalAt(x: number, y: number): { x: number; y: number; z: number } {
    const e = this.cellAt(x, y) / 2;
    const dx = (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e);
    const dy = (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e);
    const l = Math.hypot(dx, dy, 1);
    return { x: -dx / l, y: -dy / l, z: 1 / l };
  }

  /** Slope as rise / run (0.16 = 16 %) from central differences `span` meters apart (default 10 m, the 5 m cell of the real data). */
  slopeAt(x: number, y: number, span = 5): number {
    const dx = (this.heightAt(x + span, y) - this.heightAt(x - span, y)) / (2 * span);
    const dy = (this.heightAt(x, y + span) - this.heightAt(x, y - span)) / (2 * span);
    return Math.hypot(dx, dy);
  }

  /**
   * The baked grid as a Rapier heightfield (scene axes): `nrows` x `ncols` CELLS, `heights` has
   * (nrows + 1) * (ncols + 1) samples in column-major order (row index grows with scene z, i.e.
   * toward the south), `scale` is the full extent, and the field is centered on `center`.
   */
  heightfield(): { nrows: number; ncols: number; heights: Float32Array; scale: { x: number; y: number; z: number }; center: { x: number; z: number } } {
    const g = this.grid;
    const nrows = g.rows - 1;
    const ncols = g.cols - 1;
    const heights = new Float32Array(g.rows * g.cols);
    for (let c = 0; c < g.cols; c++) {
      for (let r = 0; r < g.rows; r++) heights[r + c * g.rows] = g.data[(g.rows - 1 - r) * g.cols + c] as number;
    }
    return {
      nrows,
      ncols,
      heights,
      scale: { x: ncols * g.cell, y: 1, z: nrows * g.cell },
      center: { x: g.x0 + (ncols * g.cell) / 2, z: -(g.y0 + (nrows * g.cell) / 2) },
    };
  }

  /** Lowest ground height under a footprint (corners, edge midpoints, center): a building's base. */
  footprintBase(b: Footprint): number {
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    let lo = Infinity;
    for (const u of [-0.5, 0, 0.5]) {
      for (const v of [-0.5, 0, 0.5]) {
        const lx = u * b.width;
        const ly = v * b.depth;
        lo = Math.min(lo, this.heightAt(b.center.x + lx * c - ly * s, b.center.y + lx * s + ly * c));
      }
    }
    return lo;
  }

  /**
   * The fine grid with its outer `width` m blended into the far grid, so the surface is continuous
   * where the fine grid ends (at the grid edge it equals the far grid exactly).
   */
  private blendIntoFar(g: HeightGrid, width: number): HeightGrid {
    if (!(width > 0)) return g;
    const data = Float32Array.from(g.data);
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.cols; i++) {
        const edge = Math.min(i, j, g.cols - 1 - i, g.rows - 1 - j) * g.cell;
        if (edge >= width) continue;
        const t = 1 - smoothstep(0, width, edge);
        const x = g.x0 + i * g.cell;
        const y = g.y0 + j * g.cell;
        const farH = this.farSample(x, y);
        const k = j * g.cols + i;
        data[k] = (data[k] as number) * (1 - t) + farH * t;
      }
    }
    return { ...g, data };
  }

  // ---- water carve -----------------------------------------------------------------------

  /**
   * H0 + the layer 3 carve, except under street carriageways (and their shoulder): there the carve fades out,
   * so an existing street crosses a river on its own level (a culvert for now; layer 5 will place real bridges).
   */
  private carvedBase(base: HeightGrid, carve: HeightGrid, graph?: GraphSnapshot): HeightGrid {
    const { x0, y0, cell, cols, rows } = base;
    const keep = new Float32Array(cols * rows); // share of the carve that is dropped (road weight)
    let minI = cols;
    let maxI = -1;
    let minJ = rows;
    let maxJ = -1;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if ((carve.data[j * cols + i] as number) !== 0) {
          if (i < minI) minI = i;
          if (i > maxI) maxI = i;
          if (j < minJ) minJ = j;
          if (j > maxJ) maxJ = j;
        }
      }
    }
    if (graph && maxI >= 0) {
      const rel = this.spec.relief;
      const nodes = graph.nodes;
      for (const e of graph.edges) {
        if (e.cls === 'frame' || !(e.width > 0)) continue;
        const a = nodes[e.a] as { x: number; y: number };
        const b = nodes[e.b] as { x: number; y: number };
        const full = e.width / 2 + e.sidewalk + 2;
        const reach = full + rel.streets.shoulder;
        const i0 = Math.max(minI, Math.floor((Math.min(a.x, b.x) - reach - x0) / cell));
        const i1 = Math.min(maxI, Math.ceil((Math.max(a.x, b.x) + reach - x0) / cell));
        const j0 = Math.max(minJ, Math.floor((Math.min(a.y, b.y) - reach - y0) / cell));
        const j1 = Math.min(maxJ, Math.ceil((Math.max(a.y, b.y) + reach - y0) / cell));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const d = distToSegment(x0 + i * cell, y0 + j * cell, a.x, a.y, b.x, b.y);
            if (d >= reach) continue;
            const w = d <= full ? 1 : 1 - smoothstep(full, reach, d);
            if (w > (keep[j * cols + i] as number)) keep[j * cols + i] = w;
          }
        }
      }
    }
    const data = new Float32Array(cols * rows);
    for (let k = 0; k < data.length; k++) data[k] = (base.data[k] as number) + (carve.data[k] as number) * (1 - (keep[k] as number));
    return { x0, y0, cell, cols, rows, data };
  }

  // ---- street grading ---------------------------------------------------------------------

  private gradeStreets(graph: GraphSnapshot, base: HeightGrid): { grid: HeightGrid; grading: StreetGrading } {
    const rel = this.spec.relief;
    const streets = graph.edges.filter((e) => e.cls !== 'frame' && e.width > 0);
    const nodes = graph.nodes;
    const h = new Float64Array(nodes.length).fill(NaN);
    for (const e of streets) {
      for (const id of [e.a, e.b]) {
        if (Number.isNaN(h[id])) {
          const n = nodes[id] as { x: number; y: number };
          h[id] = this.baseHeightAt(n.x, n.y);
        }
      }
    }
    // Relax: pull the two ends of an edge toward each other until its grade is within the limit.
    const limit = rel.streets.maxGrade * GRADE_MARGIN;
    // Every street edge is flat for `platform` meters at each end (a junction platform), so the
    // streets meeting at a node share one surface there; the grade limit applies to the rest.
    const platformOf = (e: { width: number; sidewalk: number }, L: number): number => Math.min(e.width / 2 + e.sidewalk + 2, L / 4);
    const full0 = streets.map((e) => Math.hypot((nodes[e.a] as { x: number }).x - (nodes[e.b] as { x: number }).x, (nodes[e.a] as { y: number }).y - (nodes[e.b] as { y: number }).y));
    const len = streets.map((e, i) => (full0[i] as number) - 2 * platformOf(e, full0[i] as number));
    let sweeps = 0;
    for (; sweeps < 4000; sweeps++) {
      let moved = false;
      streets.forEach((e, i) => {
        const dh = (h[e.b] as number) - (h[e.a] as number);
        const lim = limit * (len[i] as number);
        if (Math.abs(dh) > lim + 1e-9) {
          const ex = (Math.abs(dh) - lim) / 2;
          const sgn = Math.sign(dh);
          h[e.a] = (h[e.a] as number) + sgn * ex;
          h[e.b] = (h[e.b] as number) - sgn * ex;
          moved = true;
        }
      });
      if (!moved) break;
    }
    let unresolved = 0;
    streets.forEach((e, i) => {
      if (Math.abs((h[e.b] as number) - (h[e.a] as number)) > rel.streets.maxGrade * (len[i] as number) + 1e-6) unresolved++;
    });

    // Rasterize: blend every grid sample toward the road surface heights around it. A road follows
    // the terrain along its centerline (sampled every PROFILE_STEP m) and is clamped to the grade
    // limit, so it only departs from the terrain where the terrain is steeper than max_grade.
    const { x0, y0, cell, cols, rows } = base;
    // Roads blend by w^6, so a road keeps its own surface where another street's shoulder overlaps.
    const PROFILE_STEP = 8;
    const maxW = new Float32Array(cols * rows);
    const sumW = new Float64Array(cols * rows);
    const sumWH = new Float64Array(cols * rows);
    streets.forEach((e, ei) => {
      const a = nodes[e.a] as { x: number; y: number };
      const b = nodes[e.b] as { x: number; y: number };
      const full = e.width / 2 + e.sidewalk + 2;
      const reach = full + rel.streets.shoulder;
      const full2 = full * full;
      const reach2 = reach * reach;
      const L = full0[ei] as number;
      const P = platformOf(e, L);
      const nInt = Math.max(1, Math.ceil((L - 2 * P) / PROFILE_STEP));
      // Stations along the edge: both ends, both platform limits, and even steps between.
      const sta: number[] = [0, P];
      for (let k = 1; k < nInt; k++) sta.push(P + ((L - 2 * P) * k) / nInt);
      sta.push(L - P, L);
      const n = sta.length - 1;
      const hs = new Float64Array(n + 1);
      hs[0] = h[e.a] as number;
      hs[1] = hs[0];
      hs[n] = h[e.b] as number;
      hs[n - 1] = hs[n];
      for (let k = 2; k < n - 1; k++) {
        const f = (sta[k] as number) / L;
        hs[k] = sample(base, (a.x + (b.x - a.x) * f - x0) / cell, (a.y + (b.y - a.y) * f - y0) / cell);
      }
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        for (let k = 2; k < n - 1; k++) {
          const st = limit * ((sta[k] as number) - (sta[k - 1] as number));
          const c = Math.min((hs[k - 1] as number) + st, Math.max((hs[k - 1] as number) - st, hs[k] as number));
          if (c !== hs[k]) { hs[k] = c; changed = true; }
        }
        for (let k = n - 2; k >= 2; k--) {
          const st = limit * ((sta[k + 1] as number) - (sta[k] as number));
          const c = Math.min((hs[k + 1] as number) + st, Math.max((hs[k + 1] as number) - st, hs[k] as number));
          if (c !== hs[k]) { hs[k] = c; changed = true; }
        }
        if (!changed) break;
      }
      for (let k = 0; k < n; k++) {
        const fa = (sta[k] as number) / L;
        const fb = (sta[k + 1] as number) / L;
        const sa = { x: a.x + (b.x - a.x) * fa, y: a.y + (b.y - a.y) * fa };
        const sb = { x: a.x + (b.x - a.x) * fb, y: a.y + (b.y - a.y) * fb };
        const ha = hs[k] as number;
        const hb = hs[k + 1] as number;
        const i0 = Math.max(0, Math.floor((Math.min(sa.x, sb.x) - reach - x0) / cell));
        const i1 = Math.min(cols - 1, Math.ceil((Math.max(sa.x, sb.x) + reach - x0) / cell));
        const j0 = Math.max(0, Math.floor((Math.min(sa.y, sb.y) - reach - y0) / cell));
        const j1 = Math.min(rows - 1, Math.ceil((Math.max(sa.y, sb.y) + reach - y0) / cell));
        const dx = sb.x - sa.x;
        const dy = sb.y - sa.y;
        const l2 = dx * dx + dy * dy;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const px = x0 + i * cell;
            const py = y0 + j * cell;
            const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - sa.x) * dx + (py - sa.y) * dy) / l2));
            const ex = px - (sa.x + t * dx);
            const ey = py - (sa.y + t * dy);
            const d2 = ex * ex + ey * ey;
            if (d2 >= reach2) continue;
            const w = d2 <= full2 ? 1 : 1 - smoothstep(full, reach, Math.sqrt(d2));
            const q = j * cols + i;
            const w2 = w * w;
            const ws = w2 * w2 * w2; // w ** SHARP (6)
            if (w > (maxW[q] as number)) maxW[q] = w;
            sumW[q] = (sumW[q] as number) + ws;
            sumWH[q] = (sumWH[q] as number) + ws * (ha + t * (hb - ha));
          }
        }
      }
    });
    const data = new Float32Array(cols * rows);
    for (let k = 0; k < data.length; k++) {
      const w = maxW[k] as number;
      data[k] = w === 0 || (sumW[k] as number) === 0 ? (base.data[k] as number) : (base.data[k] as number) + w * ((sumWH[k] as number) / (sumW[k] as number) - (base.data[k] as number));
    }
    return { grid: { x0, y0, cell, cols, rows, data }, grading: { nodeHeight: h, unresolved, sweeps } };
  }
}

function softMax(a: number, b: number, k: number): number {
  return -softMin(-a, -b, k);
}

function softMin(a: number, b: number, k: number): number {
  const m = Math.min(a, b);
  const d = Math.abs(a - b);
  return d >= k ? m : m - ((k - d) * (k - d)) / (4 * k);
}

function clampTo(g: HeightGrid, x: number, y: number): [number, number] {
  return [Math.min(g.cols - 1, Math.max(0, (x - g.x0) / g.cell)), Math.min(g.rows - 1, Math.max(0, (y - g.y0) / g.cell))];
}

function sample(g: HeightGrid, fx: number, fy: number): number {
  const i = Math.min(g.cols - 2, Math.floor(fx));
  const j = Math.min(g.rows - 2, Math.floor(fy));
  const tx = fx - i;
  const ty = fy - j;
  const k = j * g.cols + i;
  const d = g.data;
  const a = (d[k] as number) * (1 - tx) + (d[k + 1] as number) * tx;
  const b = (d[k + g.cols] as number) * (1 - tx) + (d[k + g.cols + 1] as number) * tx;
  return a * (1 - ty) + b * ty;
}
