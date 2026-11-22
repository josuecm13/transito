/**
 * Least-cost paths on the grid (Galin et al. 2010 style): A* over a 16-neighbourhood (8 + knight
 * moves) so paths are not locked to 45° steps, with a caller-supplied edge cost. Used for roads
 * (slope-penalised), the railway (stricter grade) and the canal (cheapest excavation).
 */
import type { Vec2 } from '../vec.ts';
import { cellAt, centreX, centreY, MinHeap, type GridShape } from './grid.ts';

const NB_DX = [1, 1, 0, -1, -1, -1, 0, 1, 2, 1, -1, -2, -2, -1, 1, 2];
const NB_DY = [0, 1, 1, 1, 0, -1, -1, -1, 1, 2, 2, 1, -1, -2, -2, -1];

/** Cost of moving from cell a to cell b (length `len` metres, `mid` = cell under the midpoint). Infinity blocks. */
export type EdgeCost = (a: number, b: number, len: number, mid: number) => number;

/**
 * A* from `from` to `to` (map points). `minCostPerMetre` must not exceed the cheapest edge cost per
 * metre, or the path may not be optimal. Returns cell indices, start to goal, or [] if unreachable.
 */
export function leastCostPath(g: GridShape, from: Vec2, to: Vec2, cost: EdgeCost, minCostPerMetre: number): number[] {
  const n = g.w * g.h;
  const start = cellAt(g, from.x, from.y);
  const goal = cellAt(g, to.x, to.y);
  const gScore = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(1024);
  const gx = goal % g.w;
  const gy = (goal - gx) / g.w;
  const hfun = (i: number): number => {
    const x = i % g.w;
    const y = (i - x) / g.w;
    return Math.hypot(x - gx, y - gy) * g.cell * minCostPerMetre;
  };
  gScore[start] = 0;
  heap.push(start, hfun(start));
  while (heap.size > 0) {
    const c = heap.pop();
    if (closed[c]) continue;
    if (c === goal) break;
    closed[c] = 1;
    const cx = c % g.w;
    const cy = (c - cx) / g.w;
    for (let k = 0; k < 16; k++) {
      const nx = cx + NB_DX[k]!;
      const ny = cy + NB_DY[k]!;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const j = ny * g.w + nx;
      if (closed[j]) continue;
      const len = Math.hypot(NB_DX[k]!, NB_DY[k]!) * g.cell;
      const mx = Math.round(cx + NB_DX[k]! / 2);
      const my = Math.round(cy + NB_DY[k]! / 2);
      const e = cost(c, j, len, my * g.w + mx);
      if (!Number.isFinite(e)) continue;
      const t = gScore[c]! + e;
      if (t < gScore[j]!) {
        gScore[j] = t;
        parent[j] = c;
        heap.push(j, t + hfun(j));
      }
    }
  }
  if (parent[goal] === -1 && goal !== start) return [];
  const path: number[] = [];
  for (let c = goal; c !== -1; c = parent[c]!) path.push(c);
  return path.reverse();
}

export function cellsToPoints(g: GridShape, cells: readonly number[]): Vec2[] {
  return cells.map((i) => ({ x: centreX(g, i % g.w), y: centreY(g, Math.floor(i / g.w)) }));
}

/** Chaikin corner cutting, `iterations` times; keeps the end points. */
export function chaikin(pts: readonly Vec2[], iterations = 2): Vec2[] {
  let cur = pts.slice();
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next: Vec2[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i]!;
      const b = cur[i + 1]!;
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

/** Douglas-Peucker simplification with tolerance `eps` metres. */
export function simplify(pts: readonly Vec2[], eps: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const pa = pts[a]!;
    const pb = pts[b]!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const l = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i]!.x - pa.x) * dy - (pts[i]!.y - pa.y) * dx) / l;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function polylineLength(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return s;
}

/**
 * Smooths a routed cell path (Douglas-Peucker + Chaikin), backing off to gentler settings when a
 * smoothed point would land on a blocked cell, so the drawn line never cuts across what the route
 * avoided. End points are kept exactly.
 */
export function smoothAvoiding(g: GridShape, cells: readonly number[], blocked: { readonly data: Uint8Array }, from?: Vec2, to?: Vec2): Vec2[] {
  const raw = cellsToPoints(g, cells);
  if (from) raw[0] = from;
  if (to) raw[raw.length - 1] = to;
  const tries: [number, number][] = [
    [0.8, 3],
    [0.4, 2],
    [0, 1],
  ];
  for (const [eps, it] of tries) {
    const pts = chaikin(eps > 0 ? simplify(raw, g.cell * eps) : raw, it);
    if (pts.every((q) => !blocked.data[cellAt(g, q.x, q.y)])) return pts;
  }
  return raw;
}
