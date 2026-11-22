/**
 * Reservoir behind a dam (docs/map-reshape/01-investigation/procedural-techniques.md §8).
 *
 * The dam sits on the main river near an authored hint (snapped to the cell of largest drainage area).
 * The lake is the connected set of cells in the dam's catchment that lie below the water level L,
 * reached from the dam. L is found by bisection so the lake hits a target area. Restricting the
 * flood to the catchment stands in for saddle dams. The shoreline, fingers and islands are what the
 * eroded terrain gives: drowned valleys and dry hilltops.
 */
import type { Vec2 } from '../vec.ts';
import { cellAt, centreX, centreY, mask, type FieldGrid, type MaskGrid } from './grid.ts';
import type { FlowRouting } from './hydrology.ts';

export interface LakeParams {
  readonly damHint: Vec2;
  /** Search radius (m) around the hint for the cell with the largest drainage area. */
  readonly snapRadius: number;
  /** The dam stays at least this far from the sea (m), so land separates the lake from the bay. */
  readonly minInland: number;
  /** The lake stays this far from the map frame (m): beyond it the land continues off-map. */
  readonly frameMargin: number;
  /** Target lake area, km². */
  readonly targetKm2: number;
}

export interface LakeResult {
  readonly lake: MaskGrid;
  readonly level: number;
  readonly dam: Vec2;
  readonly damCell: number;
  readonly catchmentKm2: number;
  readonly areaKm2: number;
}

/** Cells whose flow path passes through `outlet` (including it), via the routing stack. */
export function catchmentOf(routing: FlowRouting, outlet: number, n: number): Uint8Array {
  const inside = new Uint8Array(n);
  inside[outlet] = 1;
  const { stack, receiver, count } = routing;
  for (let s = 0; s < count; s++) {
    const i = stack[s]!;
    if (i !== outlet && receiver[i] !== i && inside[receiver[i]!]) inside[i] = 1;
  }
  return inside;
}

/** 4-connected flood from `seed` over `allowed` cells with height < level. Returns cell count. */
function flood(height: FieldGrid, allowed: Uint8Array, seed: number, level: number, out: Uint8Array): number {
  const { w, h } = height;
  out.fill(0);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  out[seed] = 1;
  let count = 1;
  while (head < tail) {
    const c = queue[head++]!;
    const cx = c % w;
    const cy = (c - cx) / w;
    const nb = [cx < w - 1 ? c + 1 : -1, cx > 0 ? c - 1 : -1, cy < h - 1 ? c + w : -1, cy > 0 ? c - w : -1];
    for (const j of nb) {
      if (j < 0 || out[j] || !allowed[j] || height.data[j]! >= level) continue;
      out[j] = 1;
      queue[tail++] = j;
      count++;
    }
  }
  return count;
}

export function floodReservoir(height: FieldGrid, land: MaskGrid, distToSea: FieldGrid, routing: FlowRouting, area: Float64Array, p: LakeParams): LakeResult {
  const { w, h, cell } = height;
  const n = w * h;
  // Snap the dam to the largest river near the hint.
  const r = Math.ceil(p.snapRadius / cell);
  const hc = cellAt(height, p.damHint.x, p.damHint.y);
  const hx = hc % w;
  const hy = (hc - hx) / w;
  let dam = -1;
  for (let y = Math.max(0, hy - r); y <= Math.min(h - 1, hy + r); y++) {
    for (let x = Math.max(0, hx - r); x <= Math.min(w - 1, hx + r); x++) {
      const i = y * w + x;
      if (!land.data[i] || distToSea.data[i]! < p.minInland || (x - hx) ** 2 + (y - hy) ** 2 > r * r) continue;
      if (dam < 0 || area[i]! > area[dam]!) dam = i;
    }
  }
  if (dam < 0) throw new Error('floodReservoir: no land cell inland enough near the dam hint');
  const catchment = catchmentOf(routing, dam, n);
  const fm = Math.ceil(p.frameMargin / cell);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < fm || y < fm || x >= w - fm || y >= h - fm) catchment[y * w + x] = 0;
  catchment[dam] = 1;
  let catchN = 0;
  let maxH = height.data[dam]!;
  for (let i = 0; i < n; i++) {
    if (catchment[i]) {
      catchN++;
      maxH = Math.max(maxH, height.data[i]!);
    }
  }
  const target = (p.targetKm2 * 1e6) / (cell * cell);
  const out = new Uint8Array(n);
  let lo = height.data[dam]!;
  let hi = maxH;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (flood(height, catchment, dam, mid, out) < target) lo = mid;
    else hi = mid;
  }
  const level = lo;
  const count = flood(height, catchment, dam, level, out);
  const lake = mask(height);
  lake.data.set(out);
  return {
    lake,
    level,
    dam: { x: centreX(height, dam % w), y: centreY(height, Math.floor(dam / w)) },
    damCell: dam,
    catchmentKm2: (catchN * cell * cell) / 1e6,
    areaKm2: (count * cell * cell) / 1e6,
  };
}
