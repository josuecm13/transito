/**
 * Dev-time warp of real (lon, lat) into map metres through the anchor table (specs/map/anchors.yaml).
 * Pure: no I/O, no dependency. Used only for overlays and first drafts, never for runtime geometry.
 *
 * Frame: real (lon, lat) -> metres `e = (lon + 79.5) * 109.7e3`, `n = (lat - 9.05) * 111e3`
 * (equirectangular, as tools/probe-macro-relief.mjs). Map frame: x east, y north (y = 0 is the Pacific
 * edge), so both frames have the same handedness and an orientation flip means a fold.
 *
 * Warp = piecewise-affine over the Delaunay triangulation of the anchors **in map space**.
 * Fold check = every triangle must have the same orientation in real space and in map space.
 */

export type Vec2 = [number, number];

export interface Anchor {
  id: string;
  real: Vec2; // [lon, lat]
  map: Vec2; // [x, y] metres
  note?: string;
}

export const LON_M = 109.7e3; // metres per degree of longitude (at 9 N)
export const LAT_M = 111e3; // metres per degree of latitude
export const LON0 = -79.5;
export const LAT0 = 9.05;

export const toMetres = (lon: number, lat: number): Vec2 => [(lon - LON0) * LON_M, (lat - LAT0) * LAT_M];
export const fromMetres = (e: number, n: number): Vec2 => [e / LON_M + LON0, n / LAT_M + LAT0];

const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/** Triangle as indexes into the anchor list, counter-clockwise in map space. */
export type Tri = [number, number, number];

/** Bowyer-Watson Delaunay triangulation (pure, deterministic: no randomness, ties resolved by index). */
export function delaunay(pts: Vec2[]): Tri[] {
  if (pts.length < 3) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const d = Math.max(maxX - minX, maxY - minY, 1) * 20;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const all: Vec2[] = [...pts, [cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]];
  const n = pts.length;
  let tris: Tri[] = [[n, n + 1, n + 2]];
  const inCircle = (t: Tri, p: Vec2): boolean => {
    const [a, b, c] = t.map((i) => all[i]!) as [Vec2, Vec2, Vec2];
    const o = cross(a, b, c) > 0 ? 1 : -1;
    const ax = a[0] - p[0], ay = a[1] - p[1], bx = b[0] - p[0], by = b[1] - p[1], cx2 = c[0] - p[0], cy2 = c[1] - p[1];
    const det =
      (ax * ax + ay * ay) * (bx * cy2 - cx2 * by) - (bx * bx + by * by) * (ax * cy2 - cx2 * ay) + (cx2 * cx2 + cy2 * cy2) * (ax * by - bx * ay);
    return det * o > 1e-9;
  };
  for (let i = 0; i < n; i++) {
    const p = all[i]!;
    const bad = tris.filter((t) => inCircle(t, p));
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]] as [number, number][]) {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        if (edges.has(k)) edges.delete(k);
        else edges.set(k, [a, b]);
      }
    }
    tris = tris.filter((t) => !bad.includes(t));
    for (const k of [...edges.keys()].sort()) {
      const [a, b] = edges.get(k)!;
      tris.push([a, b, i]);
    }
  }
  const out: Tri[] = [];
  for (const t of tris) {
    if (t[0] >= n || t[1] >= n || t[2] >= n) continue;
    const ccw: Tri = cross(pts[t[0]]!, pts[t[1]]!, pts[t[2]]!) > 0 ? [t[0], t[1], t[2]] : [t[0], t[2], t[1]];
    if (Math.abs(cross(pts[ccw[0]]!, pts[ccw[1]]!, pts[ccw[2]]!)) < 1e-9) continue; // degenerate sliver
    out.push(ccw);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

export interface FoldReport {
  triangles: number;
  folded: { tri: Tri; ids: [string, string, string]; realArea: number; mapArea: number }[];
  /** How many folded triangles each anchor belongs to (offending anchors first). */
  anchorFolds: { id: string; folded: number }[];
  ok: boolean;
}

/** Orientation sign of a real-space triangle versus its map-space image. */
export const orientationFlipped = (real: number, map: number): boolean => Math.sign(real) !== Math.sign(map);

/** Every Delaunay triangle (in map space) must keep its orientation in real space. */
export function foldCheck(anchors: Anchor[]): FoldReport {
  const real = anchors.map((a) => toMetres(a.real[0], a.real[1]));
  const map = anchors.map((a) => a.map);
  const tris = delaunay(map);
  const folded: FoldReport['folded'] = [];
  for (const t of tris) {
    const ra = cross(real[t[0]]!, real[t[1]]!, real[t[2]]!);
    const ma = cross(map[t[0]]!, map[t[1]]!, map[t[2]]!);
    if (orientationFlipped(ra, ma)) {
      folded.push({ tri: t, ids: [anchors[t[0]]!.id, anchors[t[1]]!.id, anchors[t[2]]!.id], realArea: ra / 2, mapArea: ma / 2 });
    }
  }
  const counts = new Map<string, number>();
  for (const f of folded) for (const id of f.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const anchorFolds = [...counts.entries()].map(([id, folded]) => ({ id, folded })).sort((a, b) => b.folded - a.folded || a.id.localeCompare(b.id));
  return { triangles: tris.length, folded, anchorFolds, ok: folded.length === 0 };
}

/** The necessary-condition test of the investigation: triples whose orientation differs real vs map. */
export function flippedTriples(anchors: Anchor[]): { total: number; flipped: [string, string, string][] } {
  const real = anchors.map((a) => toMetres(a.real[0], a.real[1]));
  const flipped: [string, string, string][] = [];
  let total = 0;
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++)
      for (let k = j + 1; k < anchors.length; k++) {
        total++;
        if (orientationFlipped(cross(real[i]!, real[j]!, real[k]!), cross(anchors[i]!.map, anchors[j]!.map, anchors[k]!.map)))
          flipped.push([anchors[i]!.id, anchors[j]!.id, anchors[k]!.id]);
      }
  return { total, flipped };
}

export interface Warp {
  anchors: Anchor[];
  tris: Tri[];
  /** real (lon, lat) -> map (x, y) */
  apply(lon: number, lat: number): Vec2;
  /** triangle used for a point (inside in real space, else nearest by centroid) */
  locate(lon: number, lat: number): { tri: Tri; inside: boolean };
}

interface Affine { a: number; b: number; c: number; d: number; e: number; f: number }

/** Affine map sending real triangle (p0,p1,p2) to map triangle (q0,q1,q2); null when the real triangle is degenerate. */
function affine(p: Vec2[], q: Vec2[]): Affine | null {
  const det = cross(p[0]!, p[1]!, p[2]!);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (v0: number, v1: number, v2: number): [number, number, number] => {
    // v = a*x + b*y + c through the three points
    const a = ((v1 - v0) * (p[2]![1] - p[0]![1]) - (v2 - v0) * (p[1]![1] - p[0]![1])) / det;
    const b = ((v2 - v0) * (p[1]![0] - p[0]![0]) - (v1 - v0) * (p[2]![0] - p[0]![0])) / det;
    return [a, b, v0 - a * p[0]![0] - b * p[0]![1]];
  };
  const [a, b, c] = solve(q[0]![0], q[1]![0], q[2]![0]);
  const [d, e, f] = solve(q[0]![1], q[1]![1], q[2]![1]);
  return { a, b, c, d, e, f };
}

export function buildWarp(anchors: Anchor[]): Warp {
  const real = anchors.map((a) => toMetres(a.real[0], a.real[1]));
  const tris = delaunay(anchors.map((a) => a.map));
  const maps = tris.map((t) => affine(t.map((i) => real[i]!), t.map((i) => anchors[i]!.map)));
  const locate = (lon: number, lat: number): { tri: Tri; inside: boolean; idx: number } => {
    const p = toMetres(lon, lat);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < tris.length; i++) {
      if (!maps[i]) continue;
      const [a, b, c] = tris[i]!.map((k) => real[k]!) as [Vec2, Vec2, Vec2];
      const s = Math.sign(cross(a, b, c));
      const w0 = cross(p, b, c) * s, w1 = cross(a, p, c) * s, w2 = cross(a, b, p) * s;
      if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) return { tri: tris[i]!, inside: true, idx: i };
      const cxy: Vec2 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      const dd = (cxy[0] - p[0]) ** 2 + (cxy[1] - p[1]) ** 2;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return { tri: tris[best]!, inside: false, idx: best };
  };
  return {
    anchors,
    tris,
    locate: (lon, lat) => {
      const r = locate(lon, lat);
      return { tri: r.tri, inside: r.inside };
    },
    apply(lon, lat) {
      const p = toMetres(lon, lat);
      const m = maps[locate(lon, lat).idx]!;
      return [m.a * p[0] + m.b * p[1] + m.c, m.d * p[0] + m.e * p[1] + m.f];
    },
  };
}

/** Even-odd point in polygon. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToPolygonEdge(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!, b = poly[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** Fraction of warped points outside the land polygon, and how far outside the worst one is (m). */
export function outsideLand(points: Vec2[], land: Vec2[]): { total: number; outside: number; fraction: number; maxDistance: number } {
  let outside = 0, maxDistance = 0;
  for (const p of points) {
    if (pointInPolygon(p, land)) continue;
    outside++;
    maxDistance = Math.max(maxDistance, distToPolygonEdge(p, land));
  }
  return { total: points.length, outside, fraction: points.length ? outside / points.length : 0, maxDistance };
}
