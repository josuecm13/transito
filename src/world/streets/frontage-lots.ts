/**
 * Frontage lots (`frontage-lots-v1`): TypeScript port of the geospatial engine's building
 * "auto fill" (geospatial-reconstruction-engine, server/app/generation/generator.py).
 *
 * Per block: walk every street-facing edge of the buildable area and lay lots whose width, depth
 * and side gap are sampled around a measured fingerprint (`FrontageLots`, world.yaml
 * `blockout.districts.<id>.frontage_lots`). A lot becomes a building only if it fits the
 * buildable ground with the front setback carved out on EVERY side, and does not overlap a
 * building already placed. Pure and deterministic: a function of (rng, buildable parts, frontage
 * edges, fingerprint, seed key); nothing here reads the street graph or the clock.
 *
 * Differences from the engine (the game has no OSM water, land use or real footprints):
 *   - Only edges that front a street are walked (the engine walks every edge of the buildable
 *     ring; here coast / barrier / frame cuts get no frontage).
 *   - "Overlap" means penetration deeper than OVERLAP_EPS. The engine uses shapely `intersects`,
 *     which also rejects lots that merely touch; with a side gap of 0 that would drop every other
 *     lot of a continuous row.
 *   - Consecutive collinear frontage edges (same street, < 1 degree apart) are walked as one.
 *   - A lot that would run past the end of its edge is trimmed to the room left (kept when it
 *     stays at least MIN_WIDTH_SHARE of the median width), instead of being dropped; the room
 *     ends one setback short of the edge's end so the next edge's strip stays free.
 *   - Corners: after an edge's row is laid, its first lot is stretched back toward the edge's
 *     start and its last lot forward toward its end (1 m then 0.25 m steps, up to 1.5 x the
 *     median width) as far as the ground (setback carved out on every side, so two frontages
 *     that meet never crowd the corner) and the neighbours allow.
 *   - A lot that does not fit at its drawn depth is retried shallower (x0.85 per try, at most 10
 *     tries, never below MIN_DEPTH_SHARE of the median depth); the engine drops it.
 *   - Jitter (rotation, slide along, slide inward; the engine's INFORMAL jitter) is drawn for
 *     every lot but applied in a final pass, and only where the turned lot still fits the ground
 *     and clears every other lot. Applied up front, rotated corners of a continuous row (side
 *     gap 0) knock out most of the lots.
 *
 * RNG RULE: each lot always draws width, depth, gap (2 uniforms each, Box–Muller) and 3 jitter
 * uniforms, accepted or not, so rejection rules never shift later lots' randomness.
 */
import type { FrontageLots, Spread } from '../spec.ts';
import type { Vec2 } from '../vec.ts';
import type { Rng } from '../rng.ts';
import type { KeepOutIndex } from './buildable.ts';
import type { Poly } from './poly.ts';
import { distToSegment, pointInPoly, polyEdges, ringArea } from './poly.ts';
import { pointInPolygon } from '../geometry.ts';

/** The engine's MIN_FOOTPRINT_SQUARE_METERS. */
export const MIN_FOOTPRINT_AREA = 15;
/** The engine's IQR_TO_SIGMA and the [0.5, 1.5] × median clamp of `sample_dimension`. */
const IQR_TO_SIGMA = 1.35;
const CLAMP_LOW = 0.5;
const CLAMP_HIGH = 1.5;
/** Two lots overlap when they interpenetrate deeper than this on every separating axis (m). */
const OVERLAP_EPS = 0.02;
/** Rounding slack on the setback distance test (m). */
const SETBACK_TOL = 0.01;
/** Front face sits this far past the setback so a lot is never exactly on the strip's edge (m). */
const FRONT_CLEARANCE = 0.001;
/** A trimmed end-of-edge lot keeps at least this share of the median width. */
const MIN_WIDTH_SHARE = 0.35;
/** A shallower retry never goes below this share of the median depth. */
const MIN_DEPTH_SHARE = 0.35;
const MAX_LOTS_PER_EDGE = 10_000;
const DEPTH_TRIES = 10;
const STRETCH_COARSE = 1;
const STRETCH_FINE = 0.25;
const MAX_STRETCH_STEPS = 12;
const DEPTH_STEP = 0.85;
const FRONT_TOL = 0.3;
const SIN_PARALLEL = Math.sin((15 * Math.PI) / 180);
const SIN_MERGE = Math.sin(Math.PI / 180);

/** A buildable-area edge that fronts a street; the part's inside is on its left (CCW outer). */
export interface FrontageEdge {
  a: Vec2;
  b: Vec2;
  /** Graph edge id of the fronting street. */
  street: number;
}

export interface FrontageLot {
  center: Vec2;
  /** Along the frontage (m). */
  width: number;
  /** Into the block (m). */
  depth: number;
  /** Radians, direction of the frontage edge plus jitter. */
  angle: number;
  /** Graph edge id of the fronting street. */
  street: number;
  levels: number;
  /** levels × level height (m). */
  height: number;
}

/** Normal draw (mean = median, sigma = IQR / 1.35) clamped to [0.5, 1.5] × median; 2 uniforms. */
export function sampleDimension(rng: Rng, s: Spread): number {
  const u1 = rng.next();
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
  const drawn = s.median + (s.iqr / IQR_TO_SIGMA) * z;
  return Math.min(Math.max(drawn, CLAMP_LOW * s.median), CLAMP_HIGH * s.median);
}

/** FNV-1a then murmur3 fmix32, / 2^32: identical to the engine's `stable_unit`. */
export function stableUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seed)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** The engine's `draw_storeys`: 2 when the seed's unit value falls under `share`, else 1. */
export const drawStoreys = (seed: string, share: number): 1 | 2 => (stableUnit(seed) < share ? 2 : 1);

/**
 * Street-facing edges of a buildable part, CCW (the inside on the left): an edge of the outer ring
 * whose midpoint lies on the buffer line (radius `k.r`) of a street keep-out, parallel to it within
 * 15 degrees (the same test parcels use). Consecutive collinear edges of one street are merged.
 */
export function frontageEdgesOf(part: Poly, keepOuts: KeepOutIndex): FrontageEdge[] {
  const ring = ringArea(part.outer) > 0 ? part.outer : [...part.outer].reverse();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const streets = keepOuts.query({ minX, minY, maxX, maxY }).filter((k) => k.street);
  const raw: (FrontageEdge | undefined)[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % ring.length] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) {
      raw.push(undefined);
      continue;
    }
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let best: { street: number; err: number } | undefined;
    for (const k of streets) {
      const sl = Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y);
      if (sl === 0) continue;
      if (Math.abs(ux * (k.b.y - k.a.y) - uy * (k.b.x - k.a.x)) / sl > SIN_PARALLEL) continue;
      const err = Math.abs(distToSegment(m, k.a, k.b) - k.r);
      if (err <= FRONT_TOL && (!best || err < best.err)) best = { street: k.edge, err };
    }
    raw.push(best ? { a, b, street: best.street } : undefined);
  }
  const out: FrontageEdge[] = [];
  for (const e of raw) {
    if (!e) continue;
    const last = out[out.length - 1];
    if (last && last.street === e.street && Math.hypot(e.a.x - last.b.x, e.a.y - last.b.y) < 0.01) {
      const l1 = Math.hypot(last.b.x - last.a.x, last.b.y - last.a.y);
      const l2 = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      const cross = ((last.b.x - last.a.x) * (e.b.y - e.a.y) - (last.b.y - last.a.y) * (e.b.x - e.a.x)) / (l1 * l2);
      const dot = (last.b.x - last.a.x) * (e.b.x - e.a.x) + (last.b.y - last.a.y) * (e.b.y - e.a.y);
      if (Math.abs(cross) < SIN_MERGE && dot > 0) {
        last.b = e.b;
        continue;
      }
    }
    out.push({ a: e.a, b: e.b, street: e.street });
  }
  // The ring's last edge may continue into its first.
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && last.street === first.street && Math.hypot(first.a.x - last.b.x, first.a.y - last.b.y) < 0.01) {
    const l1 = Math.hypot(last.b.x - last.a.x, last.b.y - last.a.y);
    const l2 = Math.hypot(first.b.x - first.a.x, first.b.y - first.a.y);
    const cross = ((last.b.x - last.a.x) * (first.b.y - first.a.y) - (last.b.y - last.a.y) * (first.b.x - first.a.x)) / (l1 * l2);
    const dot = (last.b.x - last.a.x) * (first.b.x - first.a.x) + (last.b.y - last.a.y) * (first.b.y - first.a.y);
    if (Math.abs(cross) < SIN_MERGE && dot > 0) {
      last.b = first.b;
      out.shift();
    }
  }
  return out;
}

/** Corners of a rotated rectangle, CCW from (-w/2, -d/2) (same order as `buildingCorners`). */
function corners(center: Vec2, width: number, depth: number, angle: number): Vec2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const hw = width / 2;
  const hd = depth / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([x, y]) => ({ x: center.x + (x as number) * c - (y as number) * s, y: center.y + (x as number) * s + (y as number) * c }));
}

/** Convex quads interpenetrate by more than OVERLAP_EPS (separating-axis test). */
function overlap(p: readonly Vec2[], q: readonly Vec2[]): boolean {
  for (const quad of [p, q]) {
    for (let i = 0; i < 2; i++) {
      const a = quad[i] as Vec2;
      const b = quad[i + 1] as Vec2;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / l;
      const ny = (b.x - a.x) / l;
      let p0 = Infinity;
      let p1 = -Infinity;
      let q0 = Infinity;
      let q1 = -Infinity;
      for (const v of p) {
        const d = v.x * nx + v.y * ny;
        p0 = Math.min(p0, d);
        p1 = Math.max(p1, d);
      }
      for (const v of q) {
        const d = v.x * nx + v.y * ny;
        q0 = Math.min(q0, d);
        q1 = Math.max(q1, d);
      }
      if (Math.min(p1, q1) - Math.max(p0, q0) <= OVERLAP_EPS) return false;
    }
  }
  return true;
}

function bbox(r: readonly Vec2[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of r) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return [x0, y0, x1, y1];
}

type EdgeBox = [Vec2, Vec2, number, number, number, number];

/** Edges of a part (outer and holes) in a uniform grid, for box queries. */
class EdgeGrid {
  private static readonly CELL = 16;
  private readonly cells = new Map<number, EdgeBox[]>();
  constructor(poly: Poly) {
    const c = EdgeGrid.CELL;
    for (const [a, b] of polyEdges(poly)) {
      const e: EdgeBox = [a, b, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
      for (let ix = Math.floor(e[2] / c); ix <= Math.floor(e[4] / c); ix++) {
        for (let iy = Math.floor(e[3] / c); iy <= Math.floor(e[5] / c); iy++) {
          const k = ix * 100003 + iy;
          const l = this.cells.get(k);
          if (l) l.push(e);
          else this.cells.set(k, [e]);
        }
      }
    }
  }
  /** Edges whose cells meet the box (an edge may appear more than once, or lie outside the box). */
  near(x0: number, y0: number, x1: number, y1: number): EdgeBox[] {
    const c = EdgeGrid.CELL;
    const out: EdgeBox[] = [];
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
      for (let iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) {
        const l = this.cells.get(ix * 100003 + iy);
        if (l) for (const e of l) out.push(e);
      }
    }
    return out;
  }
}

/** The segment (a, a + d) meets the box [lo0, hi0] x [lo1, hi1] (Liang-Barsky). */
function clipsBox(ax: number, dx: number, lo0: number, hi0: number, ay: number, dy: number, lo1: number, hi1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  if (dx === 0) {
    if (ax < lo0 || ax > hi0) return false;
  } else {
    const ta = (lo0 - ax) / dx;
    const tb = (hi0 - ax) / dx;
    t0 = Math.max(t0, Math.min(ta, tb));
    t1 = Math.min(t1, Math.max(ta, tb));
    if (t0 > t1) return false;
  }
  if (dy === 0) return ay >= lo1 && ay <= hi1;
  const tc = (lo1 - ay) / dy;
  const td = (hi1 - ay) / dy;
  return Math.max(t0, Math.min(tc, td)) <= Math.min(t1, Math.max(tc, td));
}

/**
 * The quad lies in the part with every part edge at least `margin` away (the setback strip carved
 * out; measured to the quad grown by `margin` on every side, i.e. a mitred buffer like the
 * engine's, so convex corners of the strip are square). Only edges near the quad are tested; if
 * none reaches into the grown quad, the quad is wholly inside or wholly outside the part, so one
 * corner decides. Each edge is clipped against the grown quad in the quad's own frame.
 */
function fitsGround(quad: readonly Vec2[], box: readonly number[], poly: Poly, grid: EdgeGrid, margin: number): boolean {
  const q0 = quad[0] as Vec2;
  const q1 = quad[1] as Vec2;
  const q3 = quad[3] as Vec2;
  const w = Math.hypot(q1.x - q0.x, q1.y - q0.y);
  const d = Math.hypot(q3.x - q0.x, q3.y - q0.y);
  const ux = (q1.x - q0.x) / w;
  const uy = (q1.y - q0.y) / w;
  const vx = (q3.x - q0.x) / d;
  const vy = (q3.y - q0.y) / d;
  const lo0 = -margin;
  const hi0 = w + margin;
  const lo1 = -margin;
  const hi1 = d + margin;
  for (const [a, b, x0, y0, x1, y1] of grid.near(box[0] as number - margin, box[1] as number - margin, box[2] as number + margin, box[3] as number + margin)) {
    if (x0 > (box[2] as number) + margin || x1 < (box[0] as number) - margin || y0 > (box[3] as number) + margin || y1 < (box[1] as number) - margin) continue;
    const ax = (a.x - q0.x) * ux + (a.y - q0.y) * uy;
    const ay = (a.x - q0.x) * vx + (a.y - q0.y) * vy;
    const dx = (b.x - q0.x) * ux + (b.y - q0.y) * uy - ax;
    const dy = (b.x - q0.x) * vx + (b.y - q0.y) * vy - ay;
    if (clipsBox(ax, dx, lo0, hi0, ay, dy, lo1, hi1)) return false;
  }
  return pointInPoly(quad[0] as Vec2, poly);
}

export interface FrontageLotsInput {
  /** The block's buildable parts (outer CCW, holes CW). */
  parts: readonly Poly[];
  /** Street-facing edges of those parts (`frontageEdgesOf`), in walk order. */
  edges: readonly { part: number; edge: FrontageEdge }[];
  cfg: FrontageLots;
  rng: Rng;
  /** Seed text for the storey draw, stable per block (e.g. the block id). */
  key: string;
}

/** Edges of every part, in part and ring order, tagged with their part index. */
export function frontageEdgesOfParts(parts: readonly Poly[], keepOuts: KeepOutIndex): { part: number; edge: FrontageEdge }[] {
  return parts.flatMap((p, part) => frontageEdgesOf(p, keepOuts).map((edge) => ({ part, edge })));
}

interface Placed {
  quad: Vec2[];
  box: [number, number, number, number];
  lot: FrontageLot;
  part: number;
  /** Frame of its edge and its extent along it, kept to stretch the lot to the edge's ends. */
  edge: FrontageEdge;
  s0: number;
  s1: number;
  rot: number;
  slide: number;
  inward: number;
}

export function frontageLots(input: FrontageLotsInput): FrontageLot[] {
  const { parts, cfg, rng, key } = input;
  const setback = cfg.frontSetback.median;
  const margin = Math.max(0, setback - SETBACK_TOL);
  const front = setback + FRONT_CLEARANCE;
  const placed: Placed[] = [];
  const holeVerts = parts.map((p) => p.holes.flat());
  const edgeGrids = parts.map((p) => new EdgeGrid(p));
  const minWidth = MIN_WIDTH_SHARE * cfg.width.median;
  const maxWidth = CLAMP_HIGH * cfg.width.median;

  /** The ground fits the quad (setback carved out on every side) and no other lot is in the way. */
  const valid = (quad: readonly Vec2[], part: number, skip?: Placed): boolean => {
    const box = bbox(quad);
    if (!fitsGround(quad, box, parts[part] as Poly, edgeGrids[part] as EdgeGrid, margin)) return false;
    if (holeVerts[part]!.some((h) => pointInPolygon(h, quad))) return false;
    return !placed.some((o) => o !== skip && o.box[0] <= box[2] && box[0] <= o.box[2] && o.box[1] <= box[3] && box[1] <= o.box[3] && overlap(quad, o.quad));
  };
  const rect = (e: FrontageEdge, s0: number, s1: number, depth: number, rot = 0, slide = 0, inward = 0) => {
    const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    const ux = (e.b.x - e.a.x) / len;
    const uy = (e.b.y - e.a.y) / len;
    const along = (s0 + s1) / 2;
    const center = {
      x: e.a.x + ux * (along + slide) - uy * (front + depth / 2 + inward),
      y: e.a.y + uy * (along + slide) + ux * (front + depth / 2 + inward),
    };
    const angle = Math.atan2(uy, ux) + (rot * Math.PI) / 180;
    return { center, angle, quad: corners(center, s1 - s0, depth, angle) };
  };

  for (const { part, edge } of input.edges) {
    const len = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y);
    let position = setback;
    let first: Placed | undefined;
    let last: Placed | undefined;
    for (let n = 0; n < MAX_LOTS_PER_EDGE; n++) {
      let width = sampleDimension(rng, cfg.width);
      const drawnDepth = sampleDimension(rng, cfg.depth);
      const gap = sampleDimension(rng, cfg.sideGap);
      const rot = (rng.next() * 2 - 1) * cfg.jitter.rotation;
      const slide = (rng.next() * 2 - 1) * cfg.jitter.offset;
      const inward = rng.next() * cfg.jitter.offset;
      // The room left on this edge ends one setback before it does (next edge's strip).
      const room = len - setback - position;
      if (width > room) {
        if (room < minWidth) break;
        width = room;
      }
      const s0 = position;
      position += width + gap;
      // Try the drawn depth, then shallower ones (down to MIN_DEPTH_SHARE of the median) until the
      // lot fits the ground and clears the buildings already placed.
      for (let k = 0; k < DEPTH_TRIES; k++) {
        const depth = drawnDepth * DEPTH_STEP ** k;
        if (k > 0 && depth < MIN_DEPTH_SHARE * cfg.depth.median) break;
        if (width * depth < MIN_FOOTPRINT_AREA) break;
        const r = rect(edge, s0, s0 + width, depth);
        if (!valid(r.quad, part)) continue;
        const lot: FrontageLot = { center: r.center, width, depth, angle: r.angle, street: edge.street, levels: 1, height: 0 };
        const pl: Placed = { quad: r.quad, box: bbox(r.quad), lot, part, edge, s0, s1: s0 + width, rot, slide, inward };
        placed.push(pl);
        first ??= pl;
        last = pl;
        break;
      }
    }
    // Stretch the row to the corners: the first lot back toward the edge's start, the last lot
    // forward toward its end, as far as the ground and its neighbours allow (up to 1.5 × median).
    const stretch = (pl: Placed | undefined, dir: -1 | 1): void => {
      if (!pl) return;
      // 1 m steps while they fit, then quarter-metre steps for the last metre.
      for (const step of [STRETCH_COARSE, STRETCH_FINE]) {
        for (let t = 0; t < MAX_STRETCH_STEPS; t++) {
          const s0 = dir < 0 ? pl.s0 - step : pl.s0;
          const s1 = dir > 0 ? pl.s1 + step : pl.s1;
          if (s0 < 0 || s1 > len || s1 - s0 > maxWidth) break;
          const r = rect(edge, s0, s1, pl.lot.depth);
          if (!valid(r.quad, part, pl)) break;
          pl.s0 = s0;
          pl.s1 = s1;
          pl.quad = r.quad;
          pl.box = bbox(r.quad);
          pl.lot = { ...pl.lot, center: r.center, width: s1 - s0 };
        }
      }
    };
    stretch(first, -1);
    stretch(last, 1);
  }

  // Informal jitter, only where it fits: a lot is turned / slid when it still clears the ground and
  // every other lot, else it stays square to the street. (Applied to the engine's draws, but a
  // continuous row would otherwise lose most of its lots to the rotated corners.)
  if (cfg.jitter.rotation > 0 || cfg.jitter.offset > 0) {
    for (const pl of placed) {
      const tries: [number, number, number][] = [
        [pl.rot, pl.slide, pl.inward],
        [pl.rot, 0, 0],
        [0, pl.slide, pl.inward],
      ];
      for (const [rot, slide, inward] of tries) {
        const r = rect(pl.edge, pl.s0, pl.s1, pl.lot.depth, rot, slide, inward);
        if (!valid(r.quad, pl.part, pl)) continue;
        pl.quad = r.quad;
        pl.box = bbox(r.quad);
        pl.lot = { ...pl.lot, center: r.center, angle: r.angle };
        break;
      }
    }
  }
  return finish(placed, cfg, key);
}

/** Storeys per building from a stable seed (block key + centroid to 0.1 m), as the engine does. */
function finish(placed: readonly { lot: FrontageLot }[], cfg: FrontageLots, key: string): FrontageLot[] {
  return placed.map(({ lot }) => {
    const levels = drawStoreys(`${key}:${lot.center.x.toFixed(1)}:${lot.center.y.toFixed(1)}`, cfg.twoStoreyShare);
    return { ...lot, levels, height: levels * cfg.levelHeight };
  });
}
