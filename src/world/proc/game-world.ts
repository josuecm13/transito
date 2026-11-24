/**
 * The procedural isthmus in the shapes the game consumes (#12 2.5). Pure: no I/O, no Three.js.
 *
 * The game reads three things from the world model, and only these members (inventory 2026-11-24):
 *   ground  heightAt, normalAt, footprintBase, heightfield(), grid (fine, active area), farGrid (whole map)
 *   water   rivers (points, width, surface), water surfaces (kind, level, ring, holes), locks
 *   cover   LandCover (world/cover.ts): classes, cellFar, cols, rows, cover, density
 * `ProcTerrain`, `waterFromIsthmus` and `coverFromIsthmus` build them from `generateIsthmus`.
 *
 * Not yet carried over: canal water and lock chambers (outside the Act 1 strip); street grading
 * (streets drape on the ground as generated).
 */
import type { Vec2 } from '../vec.ts';
import type { Rect } from '../geometry.ts';
import type { HeightGrid } from '../height-grid.ts';
import type { LandCover } from '../cover.ts';
import type { LockOut, RiverCourse, WaterPolygon } from '../water.ts';
import { sample as sampleField, type FieldGrid, type MaskGrid } from './grid.ts';
import type { Isthmus } from './isthmus.ts';
import { COVER_BEACH, COVER_CLEARING, COVER_FOREST, COVER_HIGH_FOREST, COVER_MANGROVE, COVER_PAVED } from './render.ts';

type Footprint = { center: Vec2; width: number; depth: number; angle: number };

/** Bilinear sample of a node grid at fractional node coordinates (clamped). */
function sampleNodes(g: HeightGrid, fx: number, fy: number): number {
  const x = Math.min(g.cols - 1, Math.max(0, fx));
  const y = Math.min(g.rows - 1, Math.max(0, fy));
  const i = Math.min(g.cols - 2, Math.floor(x));
  const j = Math.min(g.rows - 2, Math.floor(y));
  const tx = x - i;
  const ty = y - j;
  const d = g.data;
  const a = d[j * g.cols + i]! * (1 - tx) + d[j * g.cols + i + 1]! * tx;
  const b = d[(j + 1) * g.cols + i]! * (1 - tx) + d[(j + 1) * g.cols + i + 1]! * tx;
  return a * (1 - ty) + b * ty;
}

/** Node grid with `cell` spacing over [x0, x0 + (cols-1)·cell] × [y0, …], sampled from the generator's cell-centred field. */
export function resample(f: FieldGrid, x0: number, y0: number, cell: number, cols: number, rows: number): HeightGrid {
  const data = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) data[j * cols + i] = sampleField(f, x0 + i * cell, y0 + j * cell);
  return { x0, y0, cell, cols, rows, data };
}

export interface ProcTerrainOptions {
  /** Fine grid cell (m) over the active rect + margin (relief.grid.cell). */
  readonly cell: number;
  readonly margin: number;
  /** Whole-map grid cell (m) (relief.grid.far.cell). */
  readonly farCell: number;
  readonly bounds: { readonly width: number; readonly height: number };
}

/** Ground model from the generated height (already carved by the canal and levelled at the airport). */
export class ProcTerrain {
  readonly rect: Rect;
  readonly grid: HeightGrid;
  readonly farGrid: HeightGrid;

  constructor(height: FieldGrid, rect: Rect, o: ProcTerrainOptions) {
    this.rect = rect;
    const x0 = Math.floor((rect.minX - o.margin) / o.cell) * o.cell;
    const y0 = Math.floor((rect.minY - o.margin) / o.cell) * o.cell;
    const cols = Math.ceil((rect.maxX + o.margin - x0) / o.cell) + 1;
    const rows = Math.ceil((rect.maxY + o.margin - y0) / o.cell) + 1;
    this.grid = resample(height, x0, y0, o.cell, cols, rows);
    const fc = o.farCell;
    this.farGrid = resample(height, 0, 0, fc, Math.round(o.bounds.width / fc) + 1, Math.round(o.bounds.height / fc) + 1);
  }

  heightAt(x: number, y: number): number {
    const g = this.grid;
    const fx = (x - g.x0) / g.cell;
    const fy = (y - g.y0) / g.cell;
    if (fx >= 0 && fy >= 0 && fx <= g.cols - 1 && fy <= g.rows - 1) return sampleNodes(g, fx, fy);
    const f = this.farGrid;
    return sampleNodes(f, (x - f.x0) / f.cell, (y - f.y0) / f.cell);
  }

  private cellAt(x: number, y: number): number {
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

  /** The fine grid as a Rapier heightfield for world-physics: column-major `heights[r + c * rows]`, row r north → south (scene z), column c along x. */
  heightfield(): { nrows: number; ncols: number; heights: Float32Array; scale: { x: number; y: number; z: number }; center: { x: number; z: number } } {
    const g = this.grid;
    const nrows = g.rows - 1;
    const ncols = g.cols - 1;
    const heights = new Float32Array(g.rows * g.cols);
    for (let c = 0; c < g.cols; c++) for (let r = 0; r < g.rows; r++) heights[r + c * g.rows] = g.data[(g.rows - 1 - r) * g.cols + c]!;
    return { nrows, ncols, heights, scale: { x: ncols * g.cell, y: 1, z: nrows * g.cell }, center: { x: g.x0 + (ncols * g.cell) / 2, z: -(g.y0 + (nrows * g.cell) / 2) } };
  }
}

// ---------------------------------------------------------------------------------------- water

const signedArea = (r: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]!.x - r[i]!.x) * (r[j]!.y + r[i]!.y);
  return a / 2;
};

function inside(q: Vec2, ring: readonly Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * Outlines of the cells where `on(c)` holds, as polygons with holes (cell-edge contours, collinear
 * vertices dropped). Outer rings are counter-clockwise (positive area in spec axes), holes clockwise.
 */
export function maskPolygons(g: { w: number; h: number; cell: number }, on: (c: number) => boolean): { ring: Vec2[]; holes: Vec2[][] }[] {
  const { w, h, cell } = g;
  const is = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < w && j < h && on(j * w + i);
  // Directed boundary edges between lattice nodes (i, j), keeping the region on the left.
  const next = new Map<number, number[]>();
  const key = (i: number, j: number): number => j * (w + 1) + i;
  const add = (a: number, b: number): void => {
    const l = next.get(a);
    if (l) l.push(b);
    else next.set(a, [b]);
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!is(i, j)) continue;
      if (!is(i, j - 1)) add(key(i, j), key(i + 1, j));
      if (!is(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1));
      if (!is(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1));
      if (!is(i - 1, j)) add(key(i, j + 1), key(i, j));
    }
  }
  const rings: Vec2[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: Vec2[] = [];
      let cur = start;
      do {
        const outs = next.get(cur)!;
        const nxt = outs.pop()!;
        ring.push({ x: (cur % (w + 1)) * cell, y: Math.floor(cur / (w + 1)) * cell });
        cur = nxt;
      } while (cur !== start && (next.get(cur)?.length ?? 0) > 0);
      // Drop collinear vertices.
      const simple = ring.filter((p, k) => {
        const a = ring[(k + ring.length - 1) % ring.length]!;
        const b = ring[(k + 1) % ring.length]!;
        return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
      });
      if (simple.length >= 3) rings.push(simple);
    }
  }
  const outers = rings.filter((r) => signedArea(r) > 0).map((ring) => ({ ring, holes: [] as Vec2[][] }));
  for (const hole of rings.filter((r) => signedArea(r) < 0)) {
    const probe = hole[0]!;
    const owner = outers.filter((o) => inside({ x: probe.x + 1e-3, y: probe.y + 1e-3 }, o.ring) || inside(probe, o.ring)).sort((a, b) => Math.abs(signedArea(a.ring)) - Math.abs(signedArea(b.ring)))[0];
    owner?.holes.push(hole);
  }
  return outers;
}

/** The water the game draws. Locks stay empty until the canal is carried over. */
export interface GameWater {
  readonly rivers: readonly RiverCourse[];
  readonly water: readonly WaterPolygon[];
  readonly locks: readonly LockOut[];
}

export function waterFromIsthmus(iso: Isthmus, heightAt: (x: number, y: number) => number): GameWater {
  const lake = iso.lake.lake;
  const { w } = lake;
  // One cell wider than the lake: the water plane meets the ground at the real shoreline instead of the cell steps.
  const near = (c: number): boolean => {
    const i = c % w;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di;
      const k = c + dj * w + di;
      if (ii >= 0 && ii < w && k >= 0 && k < lake.data.length && lake.data[k] === 1) return true;
    }
    return false;
  };
  const water: WaterPolygon[] = maskPolygons(lake, near).map((p, k) => ({ id: `lake-${k}`, kind: 'lake', level: iso.lake.level, ring: p.ring, holes: p.holes }));
  const rivers: RiverCourse[] = iso.rivers.map((r, k) => {
    const pts = r.points;
    let lvl = Infinity;
    const surface = pts.map((q) => (lvl = Math.max(0, Math.min(lvl, heightAt(q.x, q.y) + 0.3))));
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    const mouth = pts[pts.length - 1]!;
    const chord = Math.hypot(mouth.x - pts[0]!.x, mouth.y - pts[0]!.y);
    return {
      id: `river-${k}`,
      outlet: 'coast',
      mouth,
      points: pts,
      surface,
      width: pts.map(() => r.width),
      depth: pts.map(() => 1),
      drainageKm2: pts.map(() => r.areaKm2),
      length,
      chord,
      tortuosity: chord > 0 ? length / chord : 1,
      maxFill: 0,
    } as unknown as RiverCourse;
  });
  return { rivers, water, locks: [] };
}

// ---------------------------------------------------------------------------------------- cover

/** Land-cover classes the game palette knows, mapped from the generator's cover classes. */
export const GAME_COVER_CLASSES = ['water', 'mangrove', 'forest', 'clearing', 'grass', 'urban_prior', 'park_reclaimed'] as const;
const PROC_TO_GAME: Record<number, (typeof GAME_COVER_CLASSES)[number]> = {
  [COVER_FOREST]: 'forest',
  [COVER_HIGH_FOREST]: 'forest',
  [COVER_CLEARING]: 'clearing',
  [COVER_MANGROVE]: 'mangrove',
  [COVER_BEACH]: 'grass',
  [COVER_PAVED]: 'urban_prior',
};

export function coverFromIsthmus(iso: Isthmus): LandCover {
  const g = iso.towns.density;
  const n = g.w * g.h;
  const cover = new Uint8Array(n);
  const density = new Uint8Array(n);
  const idx = (k: (typeof GAME_COVER_CLASSES)[number]): number => GAME_COVER_CLASSES.indexOf(k);
  const land = iso.relief.land as MaskGrid;
  for (let c = 0; c < n; c++) {
    let cls: (typeof GAME_COVER_CLASSES)[number];
    if (!land.data[c] || iso.lake.lake.data[c]) cls = 'water';
    else if (iso.towns.owner[c]) cls = 'urban_prior';
    else cls = PROC_TO_GAME[iso.cover[c]!] ?? 'forest';
    cover[c] = idx(cls);
    density[c] = cls === 'forest' ? 230 : cls === 'clearing' ? 60 : cls === 'mangrove' ? 200 : 0;
  }
  return { classes: GAME_COVER_CLASSES, cellFar: g.cell, cols: g.w, rows: g.h, cover, density };
}
