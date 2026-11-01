/**
 * Faces of a planar graph = blocks (issue #7, S3).
 *
 * Half-edge walk: each undirected edge gives two half-edges; at every node the outgoing
 * half-edges are sorted by angle, and the successor of u→v is the half-edge leaving v that comes
 * right after v→u going clockwise (the left-most turn). Each walk closes one face, with the face
 * on its left: bounded faces come out counter-clockwise (signed area > 0); every connected
 * component also yields one outer walk (area <= 0).
 *
 * - Dead-end streets inside a face (both half-edges in the same walk, "antennas") stay in
 *   `boundary` (they front the block) but are removed from `ring`, so `ring` is a plain polygon.
 * - A street loop hanging from a single bridge edge becomes a hole of the face around it, and a
 *   component that does not touch the rest (outer walk) becomes a hole of the smallest bounded
 *   face containing it.
 * - `area` is the face area bounded by street CENTERLINES (minus holes), the same definition as
 *   the engine's `blocks.area_square_meters` (ST_Polygonize over road centerlines) that the
 *   frozen reference metrics use.
 */
import type { Vec2 } from '../vec.ts';
import { pointInPolygon } from '../geometry.ts';
import type { FrameKind, GraphSnapshot } from './planar-graph.ts';

export interface HalfEdgeRef {
  edge: number;
  /** true: walked a→b. */
  forward: boolean;
}

export interface Face {
  /** Outer ring, counter-clockwise, antennas removed. */
  ring: Vec2[];
  /** Node ids of `ring`. */
  ringNodes: number[];
  /** Holes (clockwise rings). */
  holes: Vec2[][];
  /** Every half-edge walked around the face (ring, antennas, holes), in walk order. */
  boundary: HalfEdgeRef[];
  /** Signed area of the walk(s), m² (> 0 for bounded faces). */
  area: number;
}

export interface Block extends Face {
  id: number;
  /** A point strictly inside the block (not in a hole). */
  interior: Vec2;
  /** District owning `interior` (districtAt), undefined outside every district. */
  district: string | undefined;
  /**
   * Buildable width < 5 m everywhere (see `estimateBuildableWidth` for the approximation).
   * Excluded from realism metrics, like the engine's is_median.
   */
  isMedian: boolean;
  /** Touches the active-area border: the block continues outside the built area. */
  isClipped: boolean;
  /** Frame kinds along the boundary (sorted, unique). Empty = fully enclosed by streets. */
  frameKinds: FrameKind[];
  /** Approximate buildable width (m). */
  buildableWidth: number;
}

function signedArea(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j] as Vec2;
    const b = pts[i] as Vec2;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function perimeter(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j] as Vec2;
    const b = pts[i] as Vec2;
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

function convexHull(pts: readonly Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const crossO = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && crossO(lower[lower.length - 2] as Vec2, lower[lower.length - 1] as Vec2, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Vec2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i] as Vec2;
    while (upper.length >= 2 && crossO(upper[upper.length - 2] as Vec2, upper[upper.length - 1] as Vec2, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Minimum width of the oriented bounding box (= minimum caliper width of the convex hull). */
export function minObbWidth(pts: readonly Vec2[]): number {
  const h = convexHull(pts);
  if (h.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i] as Vec2;
    const b = h[(i + 1) % h.length] as Vec2;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    let far = 0;
    for (const q of h) far = Math.max(far, Math.abs((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / len);
    best = Math.min(best, far);
  }
  return best;
}

/**
 * All faces of a planar graph snapshot. `bounded` have area > 0; `outer` are the outer walks of
 * each connected component that ended up inside no bounded face.
 */
export function extractFaces(g: GraphSnapshot): { bounded: Face[]; outer: Face[] } {
  const nodePos = g.nodes;
  const E = g.edges.length;
  const origin = (h: number): number => {
    const e = g.edges[h >> 1] as GraphSnapshot['edges'][number];
    return h & 1 ? e.b : e.a;
  };
  const dest = (h: number): number => origin(h ^ 1);
  const out: number[][] = nodePos.map(() => []);
  for (let h = 0; h < 2 * E; h++) (out[origin(h)] as number[]).push(h);
  const angle = (h: number): number => {
    const a = nodePos[origin(h)] as Vec2;
    const b = nodePos[dest(h)] as Vec2;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  const pos = new Int32Array(2 * E);
  for (const list of out) {
    list.sort((p, q) => angle(p) - angle(q) || p - q);
    list.forEach((h, i) => (pos[h] = i));
  }
  const next = (h: number): number => {
    const v = dest(h);
    const list = out[v] as number[];
    const k = pos[h ^ 1] as number;
    return list[(k - 1 + list.length) % list.length] as number;
  };

  const faceOf = new Int32Array(2 * E).fill(-1);
  const cycles: number[][] = [];
  for (let h0 = 0; h0 < 2 * E; h0++) {
    if (faceOf[h0] !== -1) continue;
    const cyc: number[] = [];
    let h = h0;
    do {
      faceOf[h] = cycles.length;
      cyc.push(h);
      h = next(h);
    } while (h !== h0 && cyc.length <= 2 * E);
    cycles.push(cyc);
  }

  const pt = (n: number): Vec2 => {
    const p = nodePos[n] as Vec2;
    return { x: p.x, y: p.y };
  };
  const ref = (h: number): HalfEdgeRef => ({ edge: h >> 1, forward: (h & 1) === 0 });

  const bounded: Face[] = [];
  const outerCand: Face[] = [];
  cycles.forEach((cyc, ci) => {
    const area = signedArea(cyc.map((h) => pt(origin(h))));
    // Loops after removing antennas (edges with both half-edges in this walk).
    const kept = cyc.filter((h) => faceOf[h ^ 1] !== ci);
    const idx = new Map<number, number>();
    kept.forEach((h, i) => idx.set(h, i));
    const byOrigin = new Map<number, number[]>();
    for (const h of kept) {
      const o = origin(h);
      const l = byOrigin.get(o);
      if (l) l.push(h);
      else byOrigin.set(o, [h]);
    }
    const used = new Set<number>();
    const loops: number[][] = [];
    for (const h0 of kept) {
      if (used.has(h0)) continue;
      const loop: number[] = [];
      let h = h0;
      while (!used.has(h)) {
        used.add(h);
        loop.push(h);
        const cands = (byOrigin.get(dest(h)) ?? []).filter((c) => !used.has(c) || c === h0);
        if (cands.length === 0) break;
        const i = idx.get(h) as number;
        // Next in walk order after h (cyclically): keeps pinched faces in one loop.
        cands.sort((p, q) => (((idx.get(p) as number) - i + kept.length) % kept.length) - (((idx.get(q) as number) - i + kept.length) % kept.length));
        h = cands[0] as number;
      }
      loops.push(loop);
    }
    const rings = loops.map((l) => ({ nodes: l.map(origin), pts: l.map((h) => pt(origin(h))) })).map((r) => ({ ...r, area: signedArea(r.pts) }));
    rings.sort((p, q) => q.area - p.area);
    const main = rings[0];
    const face: Face = {
      ring: main ? main.pts : [],
      ringNodes: main ? main.nodes : [],
      holes: rings.slice(1).filter((r) => r.pts.length >= 3).map((r) => r.pts),
      boundary: cyc.map(ref),
      area,
    };
    if (area > 1e-9 && main && main.area > 0) bounded.push(face);
    else outerCand.push(face);
  });

  // Outer walks of components inside a bounded face become holes of the smallest such face.
  const boxes = bounded.map((f) => bbox(f.ring));
  const outer: Face[] = [];
  for (const o of outerCand) {
    const probeNode = o.boundary.length > 0 ? origin(o.boundary[0]!.edge * 2 + (o.boundary[0]!.forward ? 0 : 1)) : -1;
    if (probeNode < 0) continue;
    const p = pt(probeNode);
    let best = -1;
    for (let i = 0; i < bounded.length; i++) {
      const f = bounded[i] as Face;
      const b = boxes[i] as ReturnType<typeof bbox>;
      if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
      if (f.ringNodes.includes(probeNode)) continue;
      if (!pointInPolygon(p, f.ring)) continue;
      if (best < 0 || f.area < (bounded[best] as Face).area) best = i;
    }
    if (best < 0) {
      outer.push(o);
      continue;
    }
    const f = bounded[best] as Face;
    const holePts = dedupeRing(o.boundary.map((r) => pt(r.forward ? (g.edges[r.edge] as GraphSnapshot['edges'][number]).a : (g.edges[r.edge] as GraphSnapshot['edges'][number]).b)));
    if (holePts.length >= 3 && Math.abs(signedArea(holePts)) > 1e-9) f.holes.push(holePts);
    f.boundary.push(...o.boundary);
    f.area += o.area; // o.area <= 0
  }
  return { bounded, outer };
}

function dedupeRing(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const l = out[out.length - 1];
    if (!l || l.x !== p.x || l.y !== p.y) out.push(p);
  }
  return out;
}

function bbox(pts: readonly Vec2[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** A point strictly inside the face (inside the ring, outside every hole). */
export function interiorPoint(face: Face): Vec2 | undefined {
  const ring = face.ring;
  const n = ring.length;
  if (n < 3) return undefined;
  const order = [...Array(n).keys()].sort((i, j) => {
    const li = Math.hypot(ring[(i + 1) % n]!.x - ring[i]!.x, ring[(i + 1) % n]!.y - ring[i]!.y);
    const lj = Math.hypot(ring[(j + 1) % n]!.x - ring[j]!.x, ring[(j + 1) % n]!.y - ring[j]!.y);
    return lj - li || i - j;
  });
  const inside = (p: Vec2) => pointInPolygon(p, ring) && !face.holes.some((h) => pointInPolygon(p, h));
  for (const delta of [0.5, 0.1, 0.02]) {
    for (const i of order.slice(0, 8)) {
      const a = ring[i] as Vec2;
      const b = ring[(i + 1) % n] as Vec2;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 4 * delta) continue;
      // Left normal of a→b points into a counter-clockwise face.
      const p = { x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * delta, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * delta };
      if (inside(p)) return p;
    }
  }
  return undefined;
}

/**
 * Approximate buildable width of a block, without polygon boolean ops:
 *   thickness = min(minimum OBB width of the ring, 4·area / perimeter)
 *   buildable = thickness − 2 · (length-weighted mean of the boundary insets)
 * where a street half-edge insets by width/2 + sidewalk and a frame edge by 0.
 * 4A/P is the incircle diameter of a tangential polygon (exact for squares, triangles, regular
 * shapes) and catches thin L / wedge shapes whose OBB is wide; for long thin strips it is ~2×
 * the width, so the OBB term takes over. The mean inset is exact for a strip between two
 * streets and ignores corner overlaps (it overestimates the buildable width of tiny blocks a bit).
 */
export function estimateBuildableWidth(face: Face, insetOf: (ref: HalfEdgeRef) => { inset: number; length: number }): number {
  const per = perimeter(face.ring) + face.holes.reduce((s, h) => s + perimeter(h), 0);
  if (per === 0) return 0;
  const thickness = Math.min(minObbWidth(face.ring), (4 * face.area) / per);
  let wsum = 0;
  let lsum = 0;
  for (const r of face.boundary) {
    const { inset, length } = insetOf(r);
    wsum += inset * length;
    lsum += length;
  }
  return thickness - 2 * (lsum > 0 ? wsum / lsum : 0);
}

export interface BlockOptions {
  /** Keep a face only if its interior point passes (e.g. slice.isPlayableLand). */
  isInside: (p: Vec2) => boolean;
  districtOf: (p: Vec2) => string | undefined;
  /** Default 5 m (engine MIN_BUILDABLE_WIDTH_METERS). */
  minBuildableWidth?: number;
}

/** Bounded faces with a playable interior, as blocks. Ids follow face discovery order. */
export function buildBlocks(g: GraphSnapshot, opts: BlockOptions): Block[] {
  const minW = opts.minBuildableWidth ?? 5;
  const { bounded } = extractFaces(g);
  const blocks: Block[] = [];
  for (const f of bounded) {
    const interior = interiorPoint(f);
    if (!interior || !opts.isInside(interior)) continue;
    const kinds = new Set<FrameKind>();
    for (const r of f.boundary) {
      const e = g.edges[r.edge] as GraphSnapshot['edges'][number];
      if (e.frame !== undefined && e.frame !== 'connector') kinds.add(e.frame);
      else if (e.frame === 'connector') kinds.add('connector');
    }
    const buildableWidth = estimateBuildableWidth(f, (r) => {
      const e = g.edges[r.edge] as GraphSnapshot['edges'][number];
      return { inset: e.cls === 'frame' ? 0 : e.width / 2 + e.sidewalk, length: e.length };
    });
    blocks.push({
      ...f,
      id: blocks.length,
      interior,
      district: opts.districtOf(interior),
      isMedian: buildableWidth < minW,
      isClipped: kinds.has('area'),
      frameKinds: [...kinds].sort(),
      buildableWidth,
    });
  }
  return blocks;
}
