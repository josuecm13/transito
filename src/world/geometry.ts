import type { Vec2 } from './vec.ts';
import { add, distance, dot, normalize, perp, scale, sub } from './vec.ts';

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

/** Ray casting; polygon is an implicit closed ring. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return add(a, scale(ab, t));
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

export function distanceToPolyline(p: Vec2, line: readonly Vec2[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return distance(p, line[0] as Vec2);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, distanceToSegment(p, line[i] as Vec2, line[i + 1] as Vec2));
  }
  return best;
}

export function polylineLength(line: readonly Vec2[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += distance(line[i] as Vec2, line[i + 1] as Vec2);
  return total;
}

/** Edges of a closed ring, including the closing edge. */
export function segmentsOfPolygon(poly: readonly Vec2[]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i < poly.length; i++) {
    out.push([poly[i] as Vec2, poly[(i + 1) % poly.length] as Vec2]);
  }
  return out;
}

export function rotate(p: Vec2, angleRad: number, around: Vec2 = { x: 0, y: 0 }): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dx = p.x - around.x;
  const dy = p.y - around.y;
  return { x: around.x + dx * c - dy * s, y: around.y + dx * s + dy * c };
}

/** Liang-Barsky. Returns the clipped segment or undefined if fully outside. */
export function clipSegmentToRect(a: Vec2, b: Vec2, r: Rect): [Vec2, Vec2] | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dy, a.y - r.minY],
    [dy, r.maxY - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return undefined;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return undefined;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return undefined;
        if (t < t1) t1 = t;
      }
    }
  }
  // Clamp so interpolation error never leaves a point a hair outside the rect.
  const at = (t: number): Vec2 => ({
    x: Math.min(r.maxX, Math.max(r.minX, a.x + dx * t)),
    y: Math.min(r.maxY, Math.max(r.minY, a.y + dy * t)),
  });
  return [t0 === 0 ? a : at(t0), t1 === 1 ? b : at(t1)];
}

/** Clip a polyline to a rect; contiguous pieces are merged, a re-entry starts a new piece. */
export function clipPolylineToRect(line: readonly Vec2[], rect: Rect): Vec2[][] {
  const pieces: Vec2[][] = [];
  let current: Vec2[] | undefined;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = clipSegmentToRect(line[i] as Vec2, line[i + 1] as Vec2, rect);
    if (!seg) {
      current = undefined;
      continue;
    }
    const [s, e] = seg;
    const last = current?.[current.length - 1];
    if (current && last && last.x === s.x && last.y === s.y) {
      current.push(e);
    } else {
      current = [s, e];
      pieces.push(current);
    }
  }
  return pieces;
}

/**
 * Offset a polyline sideways; positive d = left of travel direction. Miter joins, with the
 * miter length clamped to `miterLimit * |d|` so sharp corners do not spike.
 */
export function offsetPolyline(line: readonly Vec2[], d: number, miterLimit = 2): Vec2[] {
  const n = line.length;
  if (n < 2) return line.slice();
  const normals: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    normals.push(perp(normalize(sub(line[i + 1] as Vec2, line[i] as Vec2))));
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = line[i] as Vec2;
    if (i === 0) {
      out.push(add(p, scale(normals[0] as Vec2, d)));
    } else if (i === n - 1) {
      out.push(add(p, scale(normals[n - 2] as Vec2, d)));
    } else {
      const n1 = normals[i - 1] as Vec2;
      const n2 = normals[i] as Vec2;
      const m = normalize(add(n1, n2));
      const cosHalf = dot(m, n1);
      // cosHalf <= 0 means a (near) reversal: fall back to the plain normal.
      const k = cosHalf > 1e-6 ? Math.min(1 / cosHalf, miterLimit) : 1;
      out.push(add(p, scale(cosHalf > 1e-6 ? m : n1, d * k)));
    }
  }
  return out;
}

/** x of the polyline at height y (first crossing), or undefined outside its y range. */
export function polylineXAtY(line: readonly Vec2[], y: number): number | undefined {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    if (a.y === b.y) continue;
    if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) {
      return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    }
  }
  return undefined;
}
