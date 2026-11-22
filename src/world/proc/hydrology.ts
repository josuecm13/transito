/**
 * Flow routing, drainage area and landscape evolution (docs/map-reshape/01-investigation/procedural-techniques.md §1-2).
 *
 * - routeFlow: priority-flood from base-level cells (the sea). Pop order is a topological "stack"
 *   (every receiver comes before the cells that drain into it), the receiver of a cell is the
 *   neighbour that flooded it. Depressions are routed across at their spill level, so every land
 *   cell drains to the sea (Barnes, Lehman & Mulla 2014).
 * - accumulate: drainage area A (m²) by walking the stack from upstream to downstream.
 * - erode: uplift + stream-power incision dh/dt = U - K A^m S (n = 1) with the implicit O(n) update of
 *   Braun & Willett 2013, plus linear hillslope diffusion. Valleys branch because drainage area
 *   concentrates; nothing is drawn by hand.
 */
import { DIST8, DX8, DY8, MinHeap, type FieldGrid, type MaskGrid } from './grid.ts';

export interface FlowRouting {
  /** Receiver index per cell; base-level cells are their own receiver. */
  readonly receiver: Int32Array;
  /** Distance to the receiver in metres (0 for base cells). */
  readonly dist: Float64Array;
  /** Cells in topological order, base level first. Length = number of reachable cells. */
  readonly stack: Int32Array;
  readonly count: number;
}

/** Priority-flood routing. `base[i] !== 0` marks base-level cells (sea). */
export function routeFlow(height: FieldGrid, base: MaskGrid): FlowRouting {
  const { w, h, cell } = height;
  const n = w * h;
  const hd = height.data;
  const receiver = new Int32Array(n).fill(-1);
  const dist = new Float64Array(n);
  const key = new Float64Array(n);
  const stack = new Int32Array(n);
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    if (base.data[i]) {
      receiver[i] = i;
      key[i] = hd[i]!;
      heap.push(i, hd[i]!);
    }
  }
  let count = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    stack[count++] = c;
    const cx = c % w;
    const cy = (c - cx) / w;
    const kc = key[c]!;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX8[k]!;
      const ny = cy + DY8[k]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (receiver[j] !== -1) continue;
      receiver[j] = c;
      dist[j] = DIST8[k]! * cell;
      const kj = Math.max(hd[j]!, kc);
      key[j] = kj;
      heap.push(j, kj);
    }
  }
  // Steepest descent (true D8) among neighbours that come earlier in the stack: any such neighbour
  // keeps the routing acyclic. Cells in flats/depressions keep the neighbour that flooded them.
  const pos = new Int32Array(n).fill(-1);
  for (let s = 0; s < count; s++) pos[stack[s]!] = s;
  for (let s = 0; s < count; s++) {
    const i = stack[s]!;
    if (receiver[i] === i) continue;
    const ix = i % w;
    const iy = (i - ix) / w;
    let best = -1;
    let bestSlope = 0;
    for (let k = 0; k < 8; k++) {
      const nx = ix + DX8[k]!;
      const ny = iy + DY8[k]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (pos[j]! < 0 || pos[j]! >= s) continue;
      const sl = (key[i]! - key[j]!) / DIST8[k]!;
      if (sl > bestSlope) {
        bestSlope = sl;
        best = k;
      }
    }
    if (best >= 0) {
      receiver[i] = (iy + DY8[best]!) * w + ix + DX8[best]!;
      dist[i] = DIST8[best]! * cell;
    }
  }
  return { receiver, dist, stack, count };
}

/** Drainage area in m² (each cell contributes cell²), accumulated downstream. */
export function accumulate(routing: FlowRouting, cell: number, n: number): Float64Array {
  const area = new Float64Array(n).fill(cell * cell);
  const { stack, receiver, count } = routing;
  for (let k = count - 1; k >= 0; k--) {
    const i = stack[k]!;
    const r = receiver[i]!;
    if (r !== i) area[r] = area[r]! + area[i]!;
  }
  return area;
}

export interface ErosionParams {
  readonly iterations: number;
  /** Erodibility K (model units). Relief at steady state scales with U / K. */
  readonly k: number;
  /** Area exponent m (n = 1). 0.4-0.5 gives natural concavity. */
  readonly m: number;
  /** Time step (model units). The implicit update is stable for any dt. */
  readonly dt: number;
  /** Hillslope diffusion number c = D dt / dx² per iteration; ≤ 0.2 keeps the explicit step stable. */
  readonly diffusion: number;
}

export interface ErosionResult {
  readonly height: FieldGrid;
  readonly area: Float64Array;
  readonly routing: FlowRouting;
}

/**
 * Landscape evolution. `uplift` is the rock uplift rate per cell (zero on base cells). Base cells keep
 * their height. Returns the final height plus the routing and drainage area of the last step.
 */
export function erode(initial: FieldGrid, base: MaskGrid, uplift: FieldGrid, p: ErosionParams): ErosionResult {
  const { w, h, cell } = initial;
  const n = w * h;
  const hd = Float64Array.from(initial.data);
  const height: FieldGrid = { w, h, cell, data: hd };
  const ud = uplift.data;
  const lap = new Float64Array(n);
  let routing = routeFlow(height, base);
  let area = accumulate(routing, cell, n);
  for (let it = 0; it < p.iterations; it++) {
    if (it > 0) {
      routing = routeFlow(height, base);
      area = accumulate(routing, cell, n);
    }
    const { stack, receiver, dist, count } = routing;
    // Implicit stream power, base level first so the receiver is already updated.
    for (let s = 0; s < count; s++) {
      const i = stack[s]!;
      const r = receiver[i]!;
      if (r === i) continue;
      const hi = hd[i]! + p.dt * ud[i]!;
      const f = (p.k * p.dt * Math.pow(area[i]!, p.m)) / dist[i]!;
      hd[i] = (hi + f * hd[r]!) / (1 + f);
    }
    // Linear hillslope diffusion (explicit, 4-neighbour, land only).
    if (p.diffusion > 0) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (base.data[i]) {
            lap[i] = 0;
            continue;
          }
          const c = hd[i]!;
          const e = x < w - 1 ? hd[i + 1]! : c;
          const ww = x > 0 ? hd[i - 1]! : c;
          const nn = y < h - 1 ? hd[i + w]! : c;
          const ss = y > 0 ? hd[i - w]! : c;
          lap[i] = e + ww + nn + ss - 4 * c;
        }
      }
      for (let i = 0; i < n; i++) if (!base.data[i]) hd[i] = hd[i]! + p.diffusion * lap[i]!;
    }
  }
  routing = routeFlow(height, base);
  area = accumulate(routing, cell, n);
  return { height, area, routing };
}

/** Max drop over 8 neighbours divided by distance: local steepest slope (m/m). */
export function slopeField(height: FieldGrid): FieldGrid {
  const { w, h, cell } = height;
  const d = height.data;
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = (d[y * w + Math.min(w - 1, x + 1)]! - d[y * w + Math.max(0, x - 1)]!) / (2 * cell);
      const gy = (d[Math.min(h - 1, y + 1) * w + x]! - d[Math.max(0, y - 1) * w + x]!) / (2 * cell);
      out[i] = Math.hypot(gx, gy);
    }
  }
  return { w, h, cell, data: out };
}
