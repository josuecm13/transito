/**
 * Polygon helpers for the city derivation (issue #7, S5): a thin, typed wrapper over
 * `polygon-clipping` (boolean ops) plus the small exact predicates the parcel / building code needs.
 *
 * Conventions: rings are OPEN (last point != first), outer rings counter-clockwise, holes
 * clockwise. `toPc` / `fromPc` convert to polygon-clipping's closed [x, y] rings.
 */
import pc from 'polygon-clipping';
import type { MultiPolygon as PcMulti, Polygon as PcPolygon, Ring as PcRing } from 'polygon-clipping';
import type { Vec2 } from '../vec.ts';

export type { PcPolygon };
import { pointInPolygon } from '../geometry.ts';

export interface Poly {
  /** Counter-clockwise, open. */
  outer: Vec2[];
  /** Clockwise, open. */
  holes: Vec2[][];
}

export function ringArea(r: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j] as Vec2;
    const b = r[i] as Vec2;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polyArea = (p: Poly): number => Math.abs(ringArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0);

const oriented = (r: Vec2[], ccw: boolean): Vec2[] => (ringArea(r) > 0 === ccw ? r : [...r].reverse());

function ringToPc(r: readonly Vec2[]): PcRing {
  const out: PcRing = r.map((p) => [p.x, p.y]);
  const f = r[0];
  if (f) out.push([f.x, f.y]);
  return out;
}

export function toPc(p: Poly): PcPolygon {
  return [ringToPc(p.outer), ...p.holes.map(ringToPc)];
}

function ringFromPc(r: PcRing): Vec2[] {
  const pts = r.map(([x, y]) => ({ x, y }));
  const f = pts[0];
  const l = pts[pts.length - 1];
  if (f && l && f.x === l.x && f.y === l.y) pts.pop();
  return pts;
}

/** polygon-clipping output → Polys (normalized orientation), dropping parts below `minArea` m². */
export function fromPc(m: PcMulti, minArea = 1e-6): Poly[] {
  const out: Poly[] = [];
  for (const poly of m) {
    const [o, ...hs] = poly;
    if (!o) continue;
    const outer = oriented(ringFromPc(o), true);
    if (outer.length < 3) continue;
    const holes = hs.map(ringFromPc).filter((h) => h.length >= 3).map((h) => oriented(h, false));
    const p = { outer, holes };
    if (polyArea(p) >= minArea) out.push(p);
  }
  return out;
}

/**
 * polygon-clipping occasionally throws on near-degenerate input ("Unable to find segment ... in
 * SweepLine tree"). Every op is retried once with all coordinates snapped to a 1 mm grid (street
 * buffers carry a 5 cm margin, so this never lets a building onto a sidewalk); if that throws
 * too, the op returns undefined and the caller falls back conservatively.
 */
/** Running counters of `robust` outcomes (diagnostics; deriveCity reports its delta in City.stats). */
export const clipStats = { retries: 0, fallbacks: 0 };

function robust<T>(op: (snap: (g: PcPolygon) => PcPolygon) => T): T | undefined {
  try {
    return op((g) => g);
  } catch {
    clipStats.retries++;
    const snap = (g: PcPolygon): PcPolygon => g.map((r) => r.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as [number, number]));
    try {
      return op(snap);
    } catch {
      clipStats.fallbacks++;
      return undefined;
    }
  }
}

/** subject - clips, or undefined if polygon-clipping failed (see `robust`). */
export function difference(subject: Poly | Poly[], clips: readonly PcPolygon[], minArea?: number): Poly[] | undefined {
  const subj: PcPolygon[] = (Array.isArray(subject) ? subject : [subject]).map(toPc);
  if (subj.length === 0) return [];
  if (clips.length === 0) return fromPc(subj, minArea);
  const m = robust((snap) => pc.difference(subj.map(snap), ...clips.map(snap)));
  return m && fromPc(m, minArea);
}

/** a intersect b, or undefined if polygon-clipping failed (see `robust`). */
export function intersection(a: Poly, b: PcPolygon, minArea?: number): Poly[] | undefined {
  const m = robust((snap) => pc.intersection(snap(toPc(a)), snap(b)));
  return m && fromPc(m, minArea);
}

/** Rectangle of half-width r around segment a→b (no caps), as a polygon-clipping polygon. */
export function segmentRect(a: Vec2, b: Vec2, r: number): PcPolygon | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return undefined;
  const nx = (-dy / len) * r;
  const ny = (dx / len) * r;
  return [[
    [a.x - nx, a.y - ny],
    [b.x - nx, b.y - ny],
    [b.x + nx, b.y + ny],
    [a.x + nx, a.y + ny],
    [a.x - nx, a.y - ny],
  ]];
}

const CAP_SIDES = 12;
const CAP_SCALE = 1 / Math.cos(Math.PI / CAP_SIDES);

/** Regular 12-gon CIRCUMSCRIBED about the circle (c, r): it contains the whole disc. */
export function capPolygon(c: Vec2, r: number): PcPolygon {
  const R = r * CAP_SCALE;
  const ring: PcRing = [];
  for (let i = 0; i < CAP_SIDES; i++) {
    const t = ((i + 0.5) * 2 * Math.PI) / CAP_SIDES;
    ring.push([c.x + R * Math.cos(t), c.y + R * Math.sin(t)]);
  }
  ring.push(ring[0] as [number, number]);
  return [ring];
}

/**
 * Polygons whose union contains the Minkowski buffer (distance <= r) of the given segments:
 * one rectangle per segment plus one circumscribed 12-gon per distinct endpoint.
 */
export function bufferSegments(segs: readonly (readonly [Vec2, Vec2, number])[]): PcPolygon[] {
  const out: PcPolygon[] = [];
  const caps = new Map<string, number>();
  for (const [a, b, r] of segs) {
    if (!(r > 0)) continue;
    const rect = segmentRect(a, b, r);
    if (rect) out.push(rect);
    for (const p of [a, b]) {
      const k = `${p.x},${p.y}`;
      if ((caps.get(k) ?? 0) < r) caps.set(k, r);
    }
  }
  for (const [k, r] of caps) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    out.push(capPolygon({ x, y }, r));
  }
  return out;
}

/** Every edge of a polygon (outer + holes) as [a, b]. */
export function polyEdges(p: Poly): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  for (const r of [p.outer, ...p.holes]) {
    for (let i = 0; i < r.length; i++) out.push([r[i] as Vec2, r[(i + 1) % r.length] as Vec2]);
  }
  return out;
}

export function pointInPoly(q: Vec2, p: Poly): boolean {
  return pointInPolygon(q, p.outer) && !p.holes.some((h) => pointInPolygon(q, h));
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

/** Distance from q to the boundary of p. */
export function distToBoundary(q: Vec2, p: Poly): number {
  let best = Infinity;
  for (const [a, b] of polyEdges(p)) best = Math.min(best, distToSegment(q, a, b));
  return best;
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Proper or touching intersection of segments ab and cd. */
export function segmentsTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
  return (d1 === 0 && on(c, d, a)) || (d2 === 0 && on(c, d, b)) || (d3 === 0 && on(a, b, c)) || (d4 === 0 && on(a, b, d));
}

/** Minimum distance between segments ab and cd (0 if they touch). */
export function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsTouch(a, b, c, d)) return 0;
  return Math.min(distToSegment(a, c, d), distToSegment(b, c, d), distToSegment(c, a, b), distToSegment(d, a, b));
}

/**
 * Convex ring `inner` lies inside p with clearance >= margin: every vertex inside p and every
 * edge of `inner` at least `margin` from every edge of p.
 */
export function ringInsidePoly(inner: readonly Vec2[], p: Poly, margin = 0): boolean {
  for (const q of inner) if (!pointInPoly(q, p)) return false;
  const edges = polyEdges(p);
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i] as Vec2;
    const b = inner[(i + 1) % inner.length] as Vec2;
    for (const [c, d] of edges) if (segmentDistance(a, b, c, d) < margin || (margin === 0 && segmentsTouch(a, b, c, d))) return false;
  }
  return true;
}

function hull(pts: readonly Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && orient(lower[lower.length - 2] as Vec2, lower[lower.length - 1] as Vec2, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i] as Vec2;
    while (upper.length >= 2 && orient(upper[upper.length - 2] as Vec2, upper[upper.length - 1] as Vec2, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export interface Obb {
  center: Vec2;
  /** Unit vector of the long side. */
  axis: Vec2;
  /** Long and short side lengths (m). */
  long: number;
  short: number;
}

/** Minimum-area oriented bounding box (rotating calipers over hull edges). */
export function minAreaObb(pts: readonly Vec2[]): Obb {
  const h = hull(pts);
  let best: Obb = { center: h[0] ?? { x: 0, y: 0 }, axis: { x: 1, y: 0 }, long: 0, short: 0 };
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i] as Vec2;
    const b = h[(i + 1) % h.length] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const q of h) {
      const pu = q.x * u.x + q.y * u.y;
      const pv = -q.x * u.y + q.y * u.x;
      if (pu < u0) u0 = pu;
      if (pu > u1) u1 = pu;
      if (pv < v0) v0 = pv;
      if (pv > v1) v1 = pv;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const center = { x: cu * u.x - cv * u.y, y: cu * u.y + cv * u.x };
      const du = u1 - u0;
      const dv = v1 - v0;
      best = du >= dv ? { center, axis: u, long: du, short: dv } : { center, axis: { x: -u.y, y: u.x }, long: dv, short: du };
    }
  }
  return best;
}

/**
 * Some part of p is at least `width` wide (contains a disc of diameter `width`).
 * Cheap sufficient test first (sample points at distance >= width/2 from the boundary), then the
 * exact test: erode p by width/2 (difference with the buffer of its own edges) and check that
 * something with area is left.
 */
export function hasWidth(p: Poly, width: number): boolean {
  const r = width / 2;
  if (p.holes.length === 0 && isConvex(p.outer)) {
    // Convex: erode by r = clip by every side's inward half-plane offset by r.
    let ring: Vec2[] = p.outer;
    const n = p.outer.length;
    for (let i = 0; i < n && ring.length >= 3; i++) {
      const a = p.outer[i] as Vec2;
      const b = p.outer[(i + 1) % n] as Vec2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      const nrm = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      ring = clipHalfPlane(ring, { x: a.x + nrm.x * r, y: a.y + nrm.y * r }, nrm);
    }
    return ring.length >= 3 && ringArea(ring) > 1e-3;
  }
  const obb = minAreaObb(p.outer);
  if (obb.short < width) return false;
  const xs = p.outer.map((q) => q.x);
  const ys = p.outer.map((q) => q.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const n = 8;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const q = { x: minX + ((i + 0.5) * (maxX - minX)) / n, y: minY + ((j + 0.5) * (maxY - minY)) / n };
      if (pointInPoly(q, p) && distToBoundary(q, p) >= r) return true;
    }
  }
  const segs = polyEdges(p).map(([a, b]) => [a, b, r] as const);
  // A failed op counts as 'not wide': the part is dropped (conservative).
  return (difference(p, bufferSegments(segs), 1e-3)?.length ?? 0) > 0;
}

/** Area-weighted centroid of the outer ring. */
export function ringCentroid(r: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const p = r[j] as Vec2;
    const q = r[i] as Vec2;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-12) return r[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Counter-clockwise ring with no reflex vertex (collinear vertices allowed). */
export function isConvex(r: readonly Vec2[]): boolean {
  const n = r.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = r[(i + n - 1) % n] as Vec2;
    const b = r[i] as Vec2;
    const c = r[(i + 1) % n] as Vec2;
    const la = Math.hypot(b.x - a.x, b.y - a.y);
    const lc = Math.hypot(c.x - b.x, c.y - b.y);
    if (la === 0 || lc === 0) continue;
    if (orient(a, b, c) / (la * lc) < -1e-9) return false;
  }
  return ringArea(r) > 0;
}

/**
 * Sutherland–Hodgman: the part of a CONVEX ring on the side { q : (q − c) · n >= 0 }.
 * Result is convex (possibly empty).
 */
export function clipHalfPlane(r: readonly Vec2[], c: Vec2, n: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const side = (q: Vec2) => (q.x - c.x) * n.x + (q.y - c.y) * n.y;
  for (let i = 0; i < r.length; i++) {
    const p = r[i] as Vec2;
    const q = r[(i + 1) % r.length] as Vec2;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  // Drop consecutive duplicates.
  const clean: Vec2[] = [];
  for (const p of out) {
    const l = clean[clean.length - 1];
    if (!l || Math.hypot(l.x - p.x, l.y - p.y) > 1e-9) clean.push(p);
  }
  const f = clean[0];
  const l = clean[clean.length - 1];
  if (clean.length > 1 && f && l && Math.hypot(f.x - l.x, f.y - l.y) <= 1e-9) clean.pop();
  return clean;
}

/**
 * Split a SIMPLE ring (no holes, counter-clockwise) by the line through c with normal n.
 * Classic chord walk: insert the crossings, sort them along the line, pair them (inside chords),
 * then walk the ring jumping across chords. Returns undefined in degenerate cases (a vertex on the
 * line, or the pieces' area not adding up), so callers can fall back to polygon-clipping.
 */
export function splitSimpleRing(r: readonly Vec2[], c: Vec2, n: Vec2): Vec2[][] | undefined {
  const N = r.length;
  const side = r.map((q) => (q.x - c.x) * n.x + (q.y - c.y) * n.y);
  for (const s of side) if (Math.abs(s) < 1e-7) return undefined;
  const d = { x: -n.y, y: n.x };
  type V = { p: Vec2; x: number };
  const verts: V[] = [];
  const xs: { idx: number; t: number }[] = [];
  for (let i = 0; i < N; i++) {
    const p = r[i] as Vec2;
    verts.push({ p, x: -1 });
    const j = (i + 1) % N;
    const si = side[i] as number;
    const sj = side[j] as number;
    if (si > 0 !== sj > 0) {
      const q = r[j] as Vec2;
      const t = si / (si - sj);
      const x = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      xs.push({ idx: verts.length, t: (x.x - c.x) * d.x + (x.y - c.y) * d.y });
      verts.push({ p: x, x: xs.length - 1 });
    }
  }
  if (xs.length === 0) return [r.slice()];
  if (xs.length % 2 !== 0) return undefined;
  const order = xs.map((_, i) => i).sort((a, b) => (xs[a] as { t: number }).t - (xs[b] as { t: number }).t);
  const partner = new Map<number, number>();
  for (let k = 0; k < order.length; k += 2) {
    const a = (xs[order[k] as number] as { idx: number }).idx;
    const b = (xs[order[k + 1] as number] as { idx: number }).idx;
    partner.set(a, b);
    partner.set(b, a);
  }
  const M = verts.length;
  const used = new Uint8Array(M);
  const pieces: Vec2[][] = [];
  for (let s = 0; s < M; s++) {
    if (used[s] || (verts[s] as V).x >= 0) continue;
    const loop: Vec2[] = [];
    let i = s;
    let guard = 0;
    // Original vertices are visited once; each crossing is passed twice (arrive, then jump).
    do {
      const v = verts[i] as V;
      loop.push(v.p);
      if (v.x >= 0) {
        const j = partner.get(i) as number;
        loop.push((verts[j] as V).p);
        i = (j + 1) % M;
      } else {
        used[i] = 1;
        i = (i + 1) % M;
      }
    } while (i !== s && !used[i] && guard++ <= 2 * M);
    if (i !== s) return undefined;
    if (loop.length >= 3) pieces.push(loop);
  }
  const total = Math.abs(ringArea(r));
  const sum = pieces.reduce((acc, p) => acc + ringArea(p), 0);
  if (pieces.some((p) => ringArea(p) <= 0) || Math.abs(sum - total) > 1e-6 * Math.max(1, total)) return undefined;
  return pieces;
}
