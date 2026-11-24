import type { RiverOutlet, WorldSpec } from '../spec.ts';
import type { HeightGrid } from '../terrain.ts';
import { distanceToPolyline, offsetPolyline, pointInPolygon, polylineLength } from '../geometry.ts';
import { createRng } from '../rng.ts';
import type { Vec2 } from '../vec.ts';
import type { Layer1Output } from './layer1-land-cover.ts';
import type { Layer2Output } from './layer2-relief.ts';

export interface Layer3Inputs {
  /** Not needed numerically yet (the riparian re-mask of layer 1b is a later read-time pass); optional so callers that skip layer 1 stay cheap. */
  readonly layer1?: Layer1Output;
  readonly layer2: Layer2Output;
}

/** One derived river: source (head) to mouth, with per-vertex water surface, width and depth. */
export interface RiverCourse {
  readonly id: string;
  readonly inspiredBy?: string;
  /** 'coast' or the id of the water body the river feeds. */
  readonly outlet: string;
  readonly mouth: Vec2;
  /** Vertices, source -> mouth, about one far-grid cell apart. */
  readonly points: readonly Vec2[];
  /** Water surface height (m) per vertex: non-increasing from source to mouth, the sea / lake level at the mouth. */
  readonly surface: readonly number[];
  /** Channel width (m) per vertex (Leopold-Maddock: w = a sqrt(A), capped by rivers.max_width). */
  readonly width: readonly number[];
  /** Channel depth (m) per vertex: the bed lies `depth` below the surface. */
  readonly depth: readonly number[];
  /** Drainage area (km2) per vertex, non-decreasing downstream. */
  readonly drainageKm2: readonly number[];
  readonly length: number;
  /** Source-to-mouth straight distance (m). */
  readonly chord: number;
  readonly tortuosity: number;
  /** Largest amount (m) the water surface stands above the uncarved ground along the course (pits that were filled). */
  readonly maxFill: number;
}

/** A water surface at a flat level (m). Holes are islands. */
export interface WaterPolygon {
  readonly id: string;
  readonly kind: 'lake' | 'canal' | 'chamber';
  readonly level: number;
  readonly ring: readonly Vec2[];
  readonly holes: readonly (readonly Vec2[])[];
}

export interface LockChamber {
  /** 1 = the chamber nearest the sea. */
  readonly index: number;
  /** Water level (m) of the chamber. */
  readonly level: number;
  /** Chamber floor height (m). */
  readonly floor: number;
  readonly center: Vec2;
  /** Direction of the chamber's long axis (rad, spec plane). */
  readonly angle: number;
  readonly length: number;
  readonly width: number;
  /** The water rectangle, 4 corners CCW. */
  readonly ring: readonly Vec2[];
  /** The concrete apron around the chamber, 4 corners CCW. */
  readonly apron: readonly Vec2[];
}

export interface LockOut {
  readonly id: string;
  readonly landmark: string;
  readonly position: Vec2;
  readonly steps: number;
  readonly chamber: readonly [number, number];
  /** Height (m) of the lock walls / apron top. */
  readonly apronTop: number;
  /** -1: the sea lies toward the start of the centreline; +1 toward its end. */
  readonly seaSide: -1 | 1;
  readonly chambers: readonly LockChamber[];
}

export interface IslandOut {
  readonly x: number;
  readonly y: number;
  /** Waterline radius (m): the ground crosses the lake level here. */
  readonly radius: number;
  /** Height (m) of the summit above the lake level. */
  readonly top: number;
  readonly ring: readonly Vec2[];
}

export interface CanalOut {
  /** The routes.canal polyline. */
  readonly centreline: readonly Vec2[];
  /** Cumulative arc length (m) at each centreline vertex. */
  readonly arc: readonly number[];
  readonly width: number;
  /** Depth (m) of the channel below its water level. */
  readonly depth: number;
  /** Arc-length range (m) inside geometry.land. */
  readonly landRange: readonly [number, number];
  /** Channel water, one polygon per stretch of constant level (the lock flights are chambers, below). */
  readonly reaches: readonly WaterPolygon[];
}

/**
 * Layer 3 output: derived river courses, the canal channel, Gatún Lake with islands, the lock
 * flights, and the height change (`carve`) that layers rivers, the lake basin and the channel onto H0.
 * Plain data, so it compares and serialises like any other layer output.
 */
export interface Layer3Output {
  readonly layer: 3;
  readonly generated: true;
  readonly riverIds: readonly string[];
  readonly lockIds: readonly string[];
  readonly waterBodyIds: readonly string[];
  readonly seaLevel: number;
  readonly lakeLevel: number;
  readonly rivers: readonly RiverCourse[];
  readonly canal: CanalOut;
  readonly locks: readonly LockOut[];
  readonly islands: readonly IslandOut[];
  /** Every water surface with its level: lake + inlets, canal reaches, lock chambers. (Rivers and the sea are not listed.) */
  readonly water: readonly WaterPolygon[];
  /** Height change (m) to add to H0: far grid (whole isthmus) and fine grid (active rect + margin), same nodes as layer 2. */
  readonly carve: { readonly far: HeightGrid; readonly fine: HeightGrid };
}

// ---- parameters (docs/map-reshape/03-technical/03-rivers.md and 04-canal-lake-locks.md) ----------------

const EPS = 1e-4;
const FINAL_MIN_WIDTH = 3;
/** depth = DEPTH_C * width^0.8 (m). */
const DEPTH_C = 0.3;
/** The water surface sits this share of the depth below the filled ground. */
const SURFACE_BELOW_FILL = 0.5;
/** ... and at least this share of the depth below the unfilled ground. */
const GROUND_CLEARANCE = 0.35;
/** Bank slope of a river channel (rise / run). */
const RIVER_BANK_SLOPE = 0.25;
/** Climbing (in the filled surface) costs this many times the step length per unit slope when tracing a course. */
const CLIMB_COST = 60;
const GUIDE_FREE = 80;
const GUIDE_FAR = 450;
const CORRIDOR = 700;

/** Channel / river beds rise to the water level over this distance (m) at a sea mouth, so the shoreline stays at height 0. */
const MOUTH_TAPER = 150;
const CANAL_DEPTH = 8;
const CANAL_BANK_SLOPE = 0.28;
const APRON_RISE = 1.5;
const LAKE_FLOOR_SHORE = 0.8;
const LAKE_FLOOR_DEEP = 6;
const LAKE_FLOOR_RAMP = 200;
const LAKE_SHORE_RISE = 0.2;
const LAKE_BANK_SLOPE = 0.28;
const ISLAND_RADIUS: readonly [number, number] = [35, 90];
const ISLAND_TOP: readonly [number, number] = [3, 9];
const SHIPPING_MARGIN = 150;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function softMin(a: number, b: number, k: number): number {
  const m = Math.min(a, b);
  const d = Math.abs(a - b);
  return d >= k ? m : m - ((k - d) * (k - d)) / (4 * k);
}

/** Running minimum: the monotone fix that turns sampled ground heights into a bed that never rises downstream. */
export function enforceMonotone(values: number[]): number[] {
  const out = values.slice();
  for (let i = 1; i < out.length; i++) out[i] = Math.min(out[i] as number, out[i - 1] as number);
  return out;
}

// ---- min-heap (key, then value) ---------------------------------------------------------------------

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) < k || ((keys[p] as number) === k && (vals[p] as number) < v)) break;
      keys[i] = keys[p] as number;
      vals[i] = vals[p] as number;
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  /** Removes the smallest entry; returns its value (key in `lastKey`). */
  lastKey = 0;
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0] as number;
    this.lastKey = keys[0] as number;
    const k = keys.pop() as number;
    const v = vals.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && ((keys[c + 1] as number) < (keys[c] as number) || ((keys[c + 1] as number) === (keys[c] as number) && (vals[c + 1] as number) < (vals[c] as number)))) c++;
        if ((keys[c] as number) > k || ((keys[c] as number) === k && (vals[c] as number) > v)) break;
        keys[i] = keys[c] as number;
        vals[i] = vals[c] as number;
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return top;
  }
}

const NB: readonly (readonly [number, number])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

function segDist(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function ringDist(px: number, py: number, ring: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) d = Math.min(d, segDist(px, py, ring[i] as Vec2, ring[(i + 1) % ring.length] as Vec2));
  return d;
}

function bboxOf(pts: readonly Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function circleRing(x: number, y: number, r: number, n = 16): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) out.push({ x: x + r * Math.cos((i / n) * Math.PI * 2), y: y + r * Math.sin((i / n) * Math.PI * 2) });
  return out;
}

// ---- flow: priority-flood fill + D8 + accumulation on the far grid --------------------------------------

interface Flow {
  cols: number;
  rows: number;
  cell: number;
  /** 0 land, 1 sea, 2 lake. */
  kind: Uint8Array;
  /** Filled surface (Barnes 2014, epsilon variant). */
  fill: Float64Array;
  /** Downstream neighbour (the D8 direction), -1 at an exit. */
  parent: Int32Array;
  /** Drainage area, in cells. */
  acc: Float32Array;
}

function landMask(spec: WorldSpec, g: HeightGrid): Uint8Array {
  const { width } = spec.bounds;
  const out = new Uint8Array(g.cols * g.rows);
  const ring = spec.land;
  for (let j = 0; j < g.rows; j++) {
    const y = g.y0 + j * g.cell;
    const xs: number[] = [];
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const p = ring[a] as Vec2;
      const q = ring[b] as Vec2;
      if (p.y > y !== q.y > y) xs.push(((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x);
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i < g.cols; i++) {
      // Land continues past the bounds box on its west / east / north edges: classify the clamped point.
      const x = Math.min(width - 0.01, Math.max(0.01, g.x0 + i * g.cell));
      let c = 0;
      for (const xc of xs) if (xc < x) c++;
      out[j * g.cols + i] = c % 2;
    }
  }
  return out;
}

function flood(g: HeightGrid, kind: Uint8Array, lakeLevel: number, seaLevel: number): Flow {
  const { cols, rows } = g;
  const n = cols * rows;
  const fill = new Float64Array(n);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const order = new Int32Array(n);
  let no = 0;
  const heap = new MinHeap();
  const level = (k: number): number => (kind[k] === 1 ? seaLevel : lakeLevel);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (kind[k] === 0) {
        if (i === 0 || j === 0 || i === cols - 1 || j === rows - 1) {
          closed[k] = 1;
          fill[k] = g.data[k] as number;
          heap.push(fill[k] as number, k);
        }
        continue;
      }
      closed[k] = 1;
      fill[k] = level(k);
      let edge = false;
      for (const [di, dj] of NB) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < cols && nj < rows && kind[nj * cols + ni] === 0) edge = true;
      }
      if (edge) heap.push(fill[k] as number, k);
    }
  }
  while (heap.size > 0) {
    const k = heap.pop();
    const key = heap.lastKey;
    order[no++] = k;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj] of NB) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const m = nj * cols + ni;
      if (closed[m]) continue;
      closed[m] = 1;
      const v = Math.max(g.data[m] as number, key + EPS);
      fill[m] = v;
      parent[m] = k;
      heap.push(v, m);
    }
  }
  const acc = new Float32Array(n);
  for (let k = 0; k < n; k++) acc[k] = kind[k] === 0 ? 1 : 0;
  for (let t = no - 1; t >= 0; t--) {
    const k = order[t] as number;
    const p = parent[k] as number;
    if (p >= 0) acc[p] = (acc[p] as number) + (acc[k] as number);
  }
  return { cols, rows, cell: g.cell, kind, fill, parent, acc };
}

/** Bilinear sample of a node array on the far grid. */
function sampleNodes(g: { x0: number; y0: number; cell: number; cols: number; rows: number }, data: ArrayLike<number>, x: number, y: number): number {
  const fx = Math.min(g.cols - 1.0001, Math.max(0, (x - g.x0) / g.cell));
  const fy = Math.min(g.rows - 1.0001, Math.max(0, (y - g.y0) / g.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const k = j * g.cols + i;
  const a = (data[k] as number) * (1 - tx) + (data[k + 1] as number) * tx;
  const b = (data[k + g.cols] as number) * (1 - tx) + (data[k + g.cols + 1] as number) * tx;
  return a * (1 - ty) + b * ty;
}

// ---- rivers -----------------------------------------------------------------------------------------------

interface RawRiver {
  it: RiverOutlet;
  nodes: number[];
  pts: Vec2[];
  cumArea: number[];
}

function traceRiver(it: RiverOutlet, g: HeightGrid, flow: Flow, lakeRings: ReadonlyMap<string, readonly Vec2[]>): RawRiver {
  const { cols, rows, cell } = flow;
  const n = cols * rows;
  const guide: Vec2[] = [it.mouth, ...it.guide];
  const source = guide[guide.length - 1] as Vec2;
  const nodeOf = (p: Vec2): number => Math.min(rows - 1, Math.max(0, Math.round(p.y / cell))) * cols + Math.min(cols - 1, Math.max(0, Math.round(p.x / cell)));
  const lakeId = it.outlet?.waterBody;
  const lakeRing = lakeId ? lakeRings.get(lakeId) : undefined;
  // Only the water body a river feeds is a valid mouth; every other lake and the sea are barriers to the trace.
  const blocked = (k: number): boolean => flow.kind[k] !== 0;
  const insideLake = (k: number): boolean => lakeRing !== undefined && pointInPolygon({ x: (k % cols) * cell, y: Math.floor(k / cols) * cell }, lakeRing);
  const start = nodeOf(source);
  // Target: the land node nearest the mouth (outside the lake it feeds).
  let target = -1;
  let best = Infinity;
  const mi = Math.round(it.mouth.x / cell);
  const mj = Math.round(it.mouth.y / cell);
  for (let dj = -4; dj <= 4; dj++) {
    for (let di = -4; di <= 4; di++) {
      const i = mi + di;
      const j = mj + dj;
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const k = j * cols + i;
      if (blocked(k) || insideLake(k)) continue;
      const d = Math.hypot(i * cell - it.mouth.x, j * cell - it.mouth.y);
      if (d < best) {
        best = d;
        target = k;
      }
    }
  }
  if (target < 0) throw new Error(`river ${it.id}: no land node near the mouth`);
  if (blocked(start)) throw new Error(`river ${it.id}: source is not on land`);

  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(0, start);
  const guideFactor = new Map<number, number>();
  const factor = (k: number): number => {
    let f = guideFactor.get(k);
    if (f === undefined) {
      const d = distanceToPolyline({ x: (k % cols) * cell, y: Math.floor(k / cols) * cell }, guide);
      f = d > CORRIDOR ? Infinity : 0.6 + 2.4 * smoothstep(GUIDE_FREE, GUIDE_FAR, d);
      guideFactor.set(k, f);
    }
    return f;
  };
  while (heap.size > 0) {
    const k = heap.pop();
    if (heap.lastKey > (dist[k] as number)) continue;
    if (k === target) break;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj] of NB) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const m = nj * cols + ni;
      if (blocked(m) || (m !== target && insideLake(m))) continue;
      const f = factor(m);
      if (f === Infinity) continue;
      const len = di !== 0 && dj !== 0 ? cell * Math.SQRT2 : cell;
      const climb = Math.max(0, (flow.fill[m] as number) - (flow.fill[k] as number));
      const stream = 1 - 0.4 * Math.min(1, (flow.acc[m] as number) / 400);
      const c = (dist[k] as number) + len * f * stream * (1 + (CLIMB_COST * climb) / len);
      if (c < (dist[m] as number)) {
        dist[m] = c;
        prev[m] = k;
        heap.push(c, m);
      }
    }
  }
  if (!Number.isFinite(dist[target] as number)) throw new Error(`river ${it.id}: no course from its source to its mouth`);
  const nodes: number[] = [];
  for (let k = target; k >= 0; k = prev[k] as number) nodes.push(k);
  nodes.reverse();
  let pts: Vec2[] = nodes.map((k) => ({ x: (k % cols) * cell, y: Math.floor(k / cols) * cell }));
  // Smooth the grid-aligned staircase; ends stay put.
  for (let pass = 0; pass < 3; pass++) {
    const next = pts.map((p) => ({ ...p }));
    for (let i = 1; i < pts.length - 1; i++) {
      next[i] = { x: ((pts[i - 1] as Vec2).x + 2 * (pts[i] as Vec2).x + (pts[i + 1] as Vec2).x) / 4, y: ((pts[i - 1] as Vec2).y + 2 * (pts[i] as Vec2).y + (pts[i + 1] as Vec2).y) / 4 };
    }
    pts = next;
  }
  pts.push({ x: it.mouth.x, y: it.mouth.y });
  const cumArea: number[] = [];
  let run = 0;
  const cellKm2 = (cell * cell) / 1e6;
  for (const k of nodes) {
    run = Math.max(run, (flow.acc[k] as number) * cellKm2);
    cumArea.push(run);
  }
  cumArea.push(run);
  return { it, nodes, pts, cumArea };
}

function finishRiver(raw: RawRiver, a: number, maxWidth: number, g: HeightGrid, flow: Flow, level: number): RiverCourse {
  const { it, pts, cumArea } = raw;
  const width = cumArea.map((A) => Math.min(maxWidth, Math.max(FINAL_MIN_WIDTH, a * Math.sqrt(A))));
  const cum = [0];
  for (let i = pts.length - 2; i >= 0; i--) cum.unshift((cum[0] as number) + Math.hypot((pts[i + 1] as Vec2).x - (pts[i] as Vec2).x, (pts[i + 1] as Vec2).y - (pts[i] as Vec2).y));
  // The bed meets the water at the mouth (distance 0), so the shoreline stays at the sea / lake level.
  const depth = width.map((w, i) => DEPTH_C * Math.pow(w, 0.8) * smoothstep(0, MOUTH_TAPER, cum[i] as number));
  // The water sits below the filled surface (which already drains) and below the ground itself: a pit on the course is
  // breached by the monotone fix, never turned into a water strip standing above the land.
  const sampled = pts.map((p, i) => Math.min(sampleNodes(g, flow.fill, p.x, p.y) - SURFACE_BELOW_FILL * (depth[i] as number), sampleNodes(g, g.data, p.x, p.y) - GROUND_CLEARANCE * (depth[i] as number)));
  // Monotone fix, then the water meets the sea / lake exactly at the mouth.
  const surface = enforceMonotone(sampled).map((s) => Math.max(s, level));
  surface[surface.length - 1] = level;
  let maxFill = 0;
  pts.forEach((p, i) => {
    maxFill = Math.max(maxFill, (surface[i] as number) - sampleNodes(g, g.data, p.x, p.y));
  });
  const length = polylineLength(pts);
  const first = pts[0] as Vec2;
  const last = pts[pts.length - 1] as Vec2;
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  const course: RiverCourse = {
    id: it.id,
    outlet: it.outlet ? it.outlet.waterBody : 'coast',
    mouth: it.mouth,
    points: pts,
    surface,
    width,
    depth,
    drainageKm2: cumArea,
    length,
    chord,
    tortuosity: length / chord,
    maxFill,
  };
  return it.inspiredBy !== undefined ? { ...course, inspiredBy: it.inspiredBy } : course;
}

// ---- carving ----------------------------------------------------------------------------------------------

interface Scratch {
  bestD: Float32Array;
  bestS: Float32Array;
  bestI: Int32Array;
  bestT: Float32Array;
  touched: number[];
}

function makeScratch(g: HeightGrid): Scratch {
  const n = g.cols * g.rows;
  return { bestD: new Float32Array(n).fill(Infinity), bestS: new Float32Array(n), bestI: new Int32Array(n), bestT: new Float32Array(n), touched: [] };
}

/**
 * Every grid node within `reach` of a polyline gets its nearest distance, the arc length of the nearest
 * point and the segment index; `apply` runs once per such node.
 */
function rasterPolyline(g: HeightGrid, pts: readonly Vec2[], arc: readonly number[], reach: number, sc: Scratch, apply: (k: number, d: number, s: number, seg: number, t: number) => void): void {
  for (let sIdx = 0; sIdx + 1 < pts.length; sIdx++) {
    const a = pts[sIdx] as Vec2;
    const b = pts[sIdx + 1] as Vec2;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - g.x0) / g.cell));
    const i1 = Math.min(g.cols - 1, Math.ceil((Math.max(a.x, b.x) + reach - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - g.y0) / g.cell));
    const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(a.y, b.y) + reach - g.y0) / g.cell));
    if (i1 < i0 || j1 < j0) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const len = Math.sqrt(l2);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = g.x0 + i * g.cell;
        const py = g.y0 + j * g.cell;
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
        const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
        if (d > reach) continue;
        const k = j * g.cols + i;
        const cur = sc.bestD[k] as number;
        if (d < cur) {
          if (cur === Infinity) sc.touched.push(k);
          sc.bestD[k] = d;
          sc.bestS[k] = (arc[sIdx] as number) + t * len;
          sc.bestI[k] = sIdx;
          sc.bestT[k] = t;
        }
      }
    }
  }
  for (const k of sc.touched) {
    apply(k, sc.bestD[k] as number, sc.bestS[k] as number, sc.bestI[k] as number, sc.bestT[k] as number);
    sc.bestD[k] = Infinity;
  }
  sc.touched.length = 0;
}

function arcOf(pts: readonly Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push((out[i - 1] as number) + Math.hypot((pts[i] as Vec2).x - (pts[i - 1] as Vec2).x, (pts[i] as Vec2).y - (pts[i - 1] as Vec2).y));
  return out;
}

interface CanalGeom {
  centreline: readonly Vec2[];
  arc: readonly number[];
  halfWidth: number;
  apron: number;
  /** Channel core height at arc length s (m), its water level and its half width. */
  coreAt: (s: number) => { h: number; level: number; half: number };
  /** Arc-length range inside geometry.land: the channel bed rises to the water level toward both ends. */
  landRange: readonly [number, number];
  landRing: readonly Vec2[];
  boundsWidth: number;
}

interface CarveInput {
  lakeRing: readonly Vec2[];
  lakeLevel: number;
  islands: readonly IslandOut[];
  canal: CanalGeom;
  chambers: readonly LockChamber[];
  rivers: readonly RiverCourse[];
  hMax: number;
  seaLevel: number;
}

/** Returns the carve delta (final - H0) on a grid. */
function carveGrid(g: HeightGrid, c: CarveInput): HeightGrid {
  const h = Float32Array.from(g.data);
  const gx1 = g.x0 + (g.cols - 1) * g.cell;
  const gy1 = g.y0 + (g.rows - 1) * g.cell;
  const overlaps = (b: { minX: number; minY: number; maxX: number; maxY: number }, pad: number): boolean => b.maxX + pad >= g.x0 && b.minX - pad <= gx1 && b.maxY + pad >= g.y0 && b.minY - pad <= gy1;
  const sc = makeScratch(g);

  // 1. Lake basin (a bowl dug into H0) with a bank rising from the shore, then the islands.
  const lakeReach = (c.hMax - c.lakeLevel) / LAKE_BANK_SLOPE + 10;
  const lb = bboxOf(c.lakeRing);
  if (overlaps(lb, lakeReach)) {
    const i0 = Math.max(0, Math.floor((lb.minX - lakeReach - g.x0) / g.cell));
    const i1 = Math.min(g.cols - 1, Math.ceil((lb.maxX + lakeReach - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((lb.minY - lakeReach - g.y0) / g.cell));
    const j1 = Math.min(g.rows - 1, Math.ceil((lb.maxY + lakeReach - g.y0) / g.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = { x: g.x0 + i * g.cell, y: g.y0 + j * g.cell };
        const k = j * g.cols + i;
        const d = ringDist(p.x, p.y, c.lakeRing);
        if (pointInPolygon(p, c.lakeRing)) {
          h[k] = c.lakeLevel - LAKE_FLOOR_SHORE - (LAKE_FLOOR_DEEP - LAKE_FLOOR_SHORE) * smoothstep(0, LAKE_FLOOR_RAMP, d);
        } else if (d < lakeReach) {
          h[k] = softMin(h[k] as number, c.lakeLevel + LAKE_SHORE_RISE + LAKE_BANK_SLOPE * d, 1);
        }
      }
    }
    for (const isl of c.islands) {
      const reach = isl.radius * 1.6;
      const ii0 = Math.max(0, Math.floor((isl.x - reach - g.x0) / g.cell));
      const ii1 = Math.min(g.cols - 1, Math.ceil((isl.x + reach - g.x0) / g.cell));
      const jj0 = Math.max(0, Math.floor((isl.y - reach - g.y0) / g.cell));
      const jj1 = Math.min(g.rows - 1, Math.ceil((isl.y + reach - g.y0) / g.cell));
      for (let j = jj0; j <= jj1; j++) {
        for (let i = ii0; i <= ii1; i++) {
          const d = Math.hypot(g.x0 + i * g.cell - isl.x, g.y0 + j * g.cell - isl.y);
          if (d > reach) continue;
          const k = j * g.cols + i;
          const cur = h[k] as number;
          const target = d < isl.radius ? c.lakeLevel + isl.top * (1 - smoothstep(0, isl.radius, d)) : c.lakeLevel - (c.lakeLevel - cur) * smoothstep(isl.radius, reach, d);
          if (target > cur) h[k] = target;
        }
      }
    }
  }

  // 2. Canal channel: core at its water level minus the depth (lock flights: the apron plateau), banks rising from it.
  const cb = bboxOf(c.canal.centreline);
  const coreHalfMax = c.canal.halfWidth + c.canal.apron;
  const canalReach = coreHalfMax + (c.hMax - (c.seaLevel - CANAL_DEPTH)) / CANAL_BANK_SLOPE + 10;
  if (overlaps(cb, canalReach)) {
    const cv = c.canal;
    rasterPolyline(g, cv.centreline, cv.arc, canalReach, sc, (k, d, s) => {
      const core = cv.coreAt(s);
      // Near a sea end the bed rises to the water level at the shoreline (and the sea floor is left alone).
      let f = 1;
      if (s < cv.landRange[0] + MOUTH_TAPER + 200 || s > cv.landRange[1] - MOUTH_TAPER - 200) {
        const px = g.x0 + (k % g.cols) * g.cell;
        const py = g.y0 + Math.floor(k / g.cols) * g.cell;
        const inside = pointInPolygon({ x: Math.min(cv.boundsWidth - 0.01, Math.max(0.01, px)), y: py }, cv.landRing);
        f = inside ? smoothstep(0, MOUTH_TAPER, ringDist(px, py, cv.landRing)) : 0;
      }
      const coreH = f < 1 ? core.level + (core.h - core.level) * f : core.h;
      // The bed is flat out to the last `rise` m of the channel half width, then a 1:1 bank reaches the water line (plus 0.2 m)
      // exactly at the channel edge, so the water never spills past its polygon; beyond it the cut slope.
      const rise = Math.max(0, core.level - coreH) + 0.2;
      const flat = Math.max(0, core.half - rise);
      if (d <= flat) h[k] = f < 1 ? Math.min(h[k] as number, coreH) : coreH;
      else {
        const off = d - flat;
        h[k] = softMin(h[k] as number, coreH + Math.min(off, rise) + CANAL_BANK_SLOPE * Math.max(0, off - rise), 1);
      }
    });
  }

  // 3. Lock chambers: floors cut into the apron plateau.
  for (const ch of c.chambers) {
    const reach = (ch.length + ch.width) / 2 + 2;
    const cx = Math.cos(ch.angle);
    const sx = Math.sin(ch.angle);
    const i0 = Math.max(0, Math.floor((ch.center.x - reach - g.x0) / g.cell));
    const i1 = Math.min(g.cols - 1, Math.ceil((ch.center.x + reach - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((ch.center.y - reach - g.y0) / g.cell));
    const j1 = Math.min(g.rows - 1, Math.ceil((ch.center.y + reach - g.y0) / g.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const rx = g.x0 + i * g.cell - ch.center.x;
        const ry = g.y0 + j * g.cell - ch.center.y;
        const u = rx * cx + ry * sx;
        const v = -rx * sx + ry * cx;
        if (Math.abs(u) <= ch.length / 2 && Math.abs(v) <= ch.width / 2) h[j * g.cols + i] = ch.floor;
      }
    }
  }

  // 4. Rivers: a flat bed `depth` under the water surface, banks rising at RIVER_BANK_SLOPE.
  for (const r of c.rivers) {
    const maxReach = Math.max(...r.width.map((w, i) => w / 2 + (r.depth[i] as number) / RIVER_BANK_SLOPE)) + 20;
    if (!overlaps(bboxOf(r.points), maxReach)) continue;
    const arc = arcOf(r.points);
    rasterPolyline(g, r.points, arc, maxReach, sc, (k, d, _s, seg, t) => {
      const lerp = (arr: readonly number[]): number => (arr[seg] as number) * (1 - t) + (arr[seg + 1] as number) * t;
      const half = lerp(r.width) / 2;
      const floor = lerp(r.surface) - lerp(r.depth);
      if (d <= half) h[k] = floor;
      else h[k] = softMin(h[k] as number, floor + RIVER_BANK_SLOPE * (d - half), 0.6);
    });
  }

  const data = new Float32Array(h.length);
  for (let k = 0; k < h.length; k++) data[k] = (h[k] as number) - (g.data[k] as number);
  return { x0: g.x0, y0: g.y0, cell: g.cell, cols: g.cols, rows: g.rows, data };
}

// ---- canal, locks, lake -------------------------------------------------------------------------------------

function pointAtArc(line: readonly Vec2[], arc: readonly number[], s: number): Vec2 {
  const total = arc[arc.length - 1] as number;
  const q = Math.min(total, Math.max(0, s));
  let i = 0;
  while (i + 2 < line.length && (arc[i + 1] as number) < q) i++;
  const a = line[i] as Vec2;
  const b = line[i + 1] as Vec2;
  const l = (arc[i + 1] as number) - (arc[i] as number);
  const t = l === 0 ? 0 : (q - (arc[i] as number)) / l;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function subLine(line: readonly Vec2[], arc: readonly number[], s0: number, s1: number): Vec2[] {
  const out: Vec2[] = [pointAtArc(line, arc, s0)];
  for (let i = 0; i < line.length; i++) if ((arc[i] as number) > s0 + 1e-6 && (arc[i] as number) < s1 - 1e-6) out.push(line[i] as Vec2);
  out.push(pointAtArc(line, arc, s1));
  return out;
}

function projectArc(line: readonly Vec2[], arc: readonly number[], p: Vec2): number {
  let best = Infinity;
  let bs = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) {
      best = d;
      bs = (arc[i] as number) + t * Math.sqrt(l2);
    }
  }
  return bs;
}

function rectRing(center: Vec2, angle: number, length: number, width: number): Vec2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const corner = (u: number, v: number): Vec2 => ({ x: center.x + u * c - v * s, y: center.y + u * s + v * c });
  return [corner(-length / 2, -width / 2), corner(length / 2, -width / 2), corner(length / 2, width / 2), corner(-length / 2, width / 2)];
}

/** Layer 3: rivers, canal, Gatún Lake and locks. Reads the spec and layer 2 (H0). Pure. */
export function layer3Water(spec: WorldSpec, inputs: Layer3Inputs): Layer3Output {
  const far = inputs.layer2.far;
  const fine = inputs.layer2.fine;
  const seaLevel = spec.canal.seaLevel;
  const lakeLevel = spec.canal.lakeLevel;
  const lakeBody = spec.waterBodies.find((b) => b.kind === 'lake');
  if (!lakeBody) throw new Error('water_bodies: no lake');
  const lakeRing = lakeBody.polygon;

  // ---- flow on the far grid
  const kind = landMask(spec, far);
  for (let k = 0; k < kind.length; k++) kind[k] = kind[k] === 1 ? 0 : 1;
  const lb = bboxOf(lakeRing);
  for (let j = Math.max(0, Math.floor(lb.minY / far.cell)); j <= Math.min(far.rows - 1, Math.ceil(lb.maxY / far.cell)); j++) {
    for (let i = Math.max(0, Math.floor(lb.minX / far.cell)); i <= Math.min(far.cols - 1, Math.ceil(lb.maxX / far.cell)); i++) {
      const k = j * far.cols + i;
      if (kind[k] === 0 && pointInPolygon({ x: i * far.cell, y: j * far.cell }, lakeRing)) kind[k] = 2;
    }
  }
  const flow = flood(far, kind, lakeLevel, seaLevel);

  // ---- rivers
  const lakeRings = new Map<string, readonly Vec2[]>(spec.waterBodies.filter((b) => b.kind === 'lake').map((b) => [b.id, b.polygon]));
  const raws = spec.rivers.items.map((it) => traceRiver(it, far, flow, lakeRings));
  const maxArea = Math.max(...raws.map((r) => r.cumArea[r.cumArea.length - 1] as number));
  const a = spec.rivers.maxWidth / Math.sqrt(maxArea);
  const rivers = raws.map((r) => finishRiver(r, a, spec.rivers.maxWidth, far, flow, r.it.outlet ? lakeLevel : seaLevel));

  // ---- canal centreline, flights
  const route = spec.routes.find((r) => r.id === spec.canal.route);
  if (!route) throw new Error(`canal.route "${spec.canal.route}" is not a route`);
  const cl = route.points;
  const arc = arcOf(cl);
  const total = arc[arc.length - 1] as number;
  const half = spec.canal.width / 2;
  let sMin = Infinity;
  let sMax = -Infinity;
  let lakeMin = Infinity;
  let lakeMax = -Infinity;
  for (let s = 0; s <= total; s += 5) {
    const p = pointAtArc(cl, arc, s);
    if (pointInPolygon(p, spec.land)) {
      sMin = Math.min(sMin, s);
      sMax = Math.max(sMax, s);
    }
    if (pointInPolygon(p, lakeRing)) {
      lakeMin = Math.min(lakeMin, s);
      lakeMax = Math.max(lakeMax, s);
    }
  }
  const apronTop = lakeLevel + APRON_RISE;

  interface Flight {
    id: string;
    fStart: number;
    fEnd: number;
    seaSide: -1 | 1;
    steps: number;
    chamber: readonly [number, number];
  }
  const flights: Flight[] = spec.canal.locks.map((lk) => {
    const lm = spec.landmarks.find((m) => m.id === lk.landmark);
    if (!lm) throw new Error(`canal.locks ${lk.id}: landmark ${lk.landmark} not found`);
    const sl = projectArc(cl, arc, lm.position);
    const len = lk.steps * lk.chamber[0];
    const seaSide: -1 | 1 = sl < lakeMin ? -1 : 1;
    return { id: lk.id, fStart: sl - len / 2, fEnd: sl + len / 2, seaSide, steps: lk.steps, chamber: lk.chamber };
  });
  const flightAt = (s: number): Flight | undefined => flights.find((f) => s >= f.fStart && s <= f.fEnd);
  const chamberLevel = (f: Flight, k: number): number => seaLevel + ((lakeLevel - seaLevel) * k) / f.steps;
  const levelAt = (s: number): number => {
    const f = flightAt(s);
    if (f) {
      const idx = Math.min(f.steps - 1, Math.floor((s - f.fStart) / f.chamber[0]));
      const k = f.seaSide === -1 ? idx + 1 : f.steps - idx;
      return chamberLevel(f, k);
    }
    let near = flights[0] as Flight;
    let nd = Infinity;
    for (const fl of flights) {
      const d = s < fl.fStart ? fl.fStart - s : s - fl.fEnd;
      if (d < nd) {
        nd = d;
        near = fl;
      }
    }
    const side = s < near.fStart ? -1 : 1;
    return side === near.seaSide ? seaLevel : lakeLevel;
  };

  const locks: LockOut[] = flights.map((f) => {
    const lk = spec.canal.locks.find((l) => l.id === f.id) as (typeof spec.canal.locks)[number];
    const lm = spec.landmarks.find((m) => m.id === lk.landmark) as (typeof spec.landmarks)[number];
    const chambers: LockChamber[] = [];
    const [length, width] = f.chamber;
    for (let k = 1; k <= f.steps; k++) {
      const s0 = f.seaSide === -1 ? f.fStart + (k - 1) * length : f.fEnd - k * length;
      const p0 = pointAtArc(cl, arc, s0);
      const p1 = pointAtArc(cl, arc, s0 + length);
      const center = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const level = chamberLevel(f, k);
      chambers.push({ index: k, level, floor: level - CANAL_DEPTH, center, angle, length, width, ring: rectRing(center, angle, length, width), apron: rectRing(center, angle, length, width + 2 * (half - width / 2 + spec.canal.apron)) });
    }
    return { id: f.id, landmark: lk.landmark, position: lm.position, steps: f.steps, chamber: f.chamber, apronTop, seaSide: f.seaSide, chambers };
  });

  // ---- canal water: one polygon per stretch of constant level between the flights, then the chambers
  const bounds = [sMin, ...flights.flatMap((f) => [f.fStart, f.fEnd]), sMax].sort((p, q) => p - q);
  const reaches: WaterPolygon[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const s0 = bounds[i] as number;
    const s1 = bounds[i + 1] as number;
    if (s1 - s0 < 1e-6 || flightAt((s0 + s1) / 2)) continue;
    const line = subLine(cl, arc, s0, s1);
    const left = offsetPolyline(line, half);
    const right = offsetPolyline(line, -half).reverse();
    reaches.push({ id: `canal-${reaches.length + 1}`, kind: 'canal', level: levelAt((s0 + s1) / 2), ring: [...left, ...right], holes: [] });
  }

  // ---- lake islands: seeded, inside the lake, off the shipping channel and apart from each other
  const rng = createRng(lakeBody.islands?.seed ?? 0);
  const want = lakeBody.islands?.count ?? 0;
  const islands: IslandOut[] = [];
  const lbb = bboxOf(lakeRing);
  for (let tries = 0; tries < 4000 && islands.length < want; tries++) {
    const x = rng.range(lbb.minX, lbb.maxX);
    const y = rng.range(lbb.minY, lbb.maxY);
    const radius = rng.range(ISLAND_RADIUS[0], ISLAND_RADIUS[1]);
    const top = rng.range(ISLAND_TOP[0], ISLAND_TOP[1]);
    const reach = radius * 1.6;
    if (!pointInPolygon({ x, y }, lakeRing)) continue;
    if (ringDist(x, y, lakeRing) < reach + 60) continue;
    if (distanceToPolyline({ x, y }, cl) < half + SHIPPING_MARGIN + reach) continue;
    if (islands.some((o) => Math.hypot(o.x - x, o.y - y) < o.radius * 1.6 + reach + 80)) continue;
    islands.push({ x, y, radius, top, ring: circleRing(x, y, radius) });
  }

  const water: WaterPolygon[] = [
    { id: lakeBody.id, kind: 'lake', level: lakeLevel, ring: lakeRing, holes: islands.map((i) => i.ring) },
    ...spec.waterBodies.filter((b) => b.kind === 'inlet').map((b): WaterPolygon => ({ id: b.id, kind: 'lake', level: lakeLevel, ring: b.polygon, holes: [] })),
    ...reaches,
    ...locks.flatMap((l) => l.chambers.map((c): WaterPolygon => ({ id: `${l.id}-${c.index}`, kind: 'chamber', level: c.level, ring: c.ring, holes: [] }))),
  ];

  // ---- carve
  const inFlight = (s: number): boolean => flightAt(s) !== undefined;
  const canalGeom: CanalGeom = {
    centreline: cl,
    arc,
    halfWidth: half,
    apron: spec.canal.apron,
    coreAt: (s) => (inFlight(s) ? { h: apronTop, level: apronTop, half: half + spec.canal.apron } : { h: levelAt(s) - CANAL_DEPTH, level: levelAt(s), half }),
    landRange: [sMin, sMax],
    landRing: spec.land,
    boundsWidth: spec.bounds.width,
  };
  let hMax = -Infinity;
  for (let k = 0; k < far.data.length; k++) hMax = Math.max(hMax, far.data[k] as number);
  const input: CarveInput = { lakeRing, lakeLevel, islands, canal: canalGeom, chambers: locks.flatMap((l) => l.chambers), rivers, hMax, seaLevel };

  return {
    layer: 3,
    generated: true,
    riverIds: spec.rivers.items.map((r) => r.id),
    lockIds: spec.canal.locks.map((l) => l.id),
    waterBodyIds: spec.waterBodies.map((b) => b.id),
    seaLevel,
    lakeLevel,
    rivers,
    canal: { centreline: cl, arc, width: spec.canal.width, depth: CANAL_DEPTH, landRange: [sMin, sMax], reaches },
    locks,
    islands,
    water,
    carve: { far: carveGrid(far, input), fine: carveGrid(fine, input) },
  };
}
