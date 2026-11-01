/**
 * Parcels (issue #7, S5): recursive oriented-bounding-box subdivision of buildable areas.
 *
 * Each buildable part is split by a line PERPENDICULAR to the long axis of its minimum-area OBB,
 * at 40–60% of the long side (one rng draw per split, always drawn), until the piece is small:
 *   split while  OBB long side > maxSide  OR  area > maxArea,
 *   but never when the long side < 2 · minSide (both halves would be too narrow),
 * with, from the district's blockout `lot` (the old grid pitch, m):
 *   maxSide = 1.5 · lot,  maxArea = 1.5 · lot²,  minSide = 0.5 · lot.
 *
 * Frontage: a parcel edge fronts street edge e when its midpoint is at distance
 * (width/2 + sidewalk + margin) ± 0.3 m from e (i.e. it lies on the buildable boundary cut by that
 * street's buffer) and it is parallel to e within 15°. A parcel's frontage street is the one with
 * the most total frontage length; parcels with less than `minFrontage` m of frontage are dropped.
 * A piece without frontage is dropped before being split further (its children cannot have
 * frontage either), which keeps the work proportional to the street-facing ring of each block.
 */
import type { Vec2 } from '../vec.ts';
import type { Rng } from '../rng.ts';
import type { KeepOut, KeepOutIndex } from './buildable.ts';
import type { Obb, PcPolygon, Poly } from './poly.ts';
import { clipHalfPlane, distToSegment, segmentDistance, intersection, isConvex, minAreaObb, polyArea, polyEdges, ringArea, splitSimpleRing } from './poly.ts';

export interface ParcelParams {
  maxSide: number;
  maxArea: number;
  minSide: number;
  /** Minimum street frontage of a kept parcel (m). */
  minFrontage: number;
  /** Pieces whose OBB is narrower than this are slivers and dropped (m). */
  minWidth: number;
}

/** Parcel parameters from a district's blockout lot pitch (m). */
export function parcelParamsFromLot(lot: number): ParcelParams {
  return { maxSide: 1.5 * lot, maxArea: 1.5 * lot * lot, minSide: 0.5 * lot, minFrontage: 3, minWidth: 4 };
}

export interface Frontage {
  /** Graph edge id of the fronting street (never a frame edge). */
  edge: number;
  /** Longest parcel edge that fronts `edge` (on the buildable boundary). */
  a: Vec2;
  b: Vec2;
  /** Total frontage length of the parcel on `edge` (m). */
  length: number;
}

export interface Parcel {
  id: number;
  block: number;
  district: string;
  poly: Poly;
  /** m² */
  area: number;
  frontage: Frontage;
}

const FRONT_TOL = 0.3;
const SIN_PARALLEL = Math.sin((15 * Math.PI) / 180);

/** Frontage of a polygon on graph streets (see module doc), or undefined below minFrontage. */
export function frontageOf(p: Poly, keepOuts: KeepOutIndex, minFrontage: number): Frontage | undefined {
  return frontageAmong(p, candidateStreets(p, keepOuts), minFrontage).frontage;
}

function candidateStreets(p: Poly, keepOuts: KeepOutIndex): KeepOut[] {
  const edges = polyEdges(p);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [a] of edges) {
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x);
    maxY = Math.max(maxY, a.y);
  }
  return keepOuts.query({ minX, minY, maxX, maxY }).filter((k) => k.street);
}

/**
 * Frontage among the given candidate streets; `matched` = the candidates some edge fronts (a
 * sub-piece's frontage can only be on these, since its edges lie on the piece's edges or on the
 * split chord).
 */
function frontageAmong(p: Poly, streets: readonly KeepOut[], minFrontage: number): { frontage: Frontage | undefined; matched: KeepOut[] } {
  const total = new Map<number, number>();
  const longest = new Map<number, { a: Vec2; b: Vec2; len: number }>();
  const matched = new Set<KeepOut>();
  for (const [a, b] of polyEdges(p)) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let best: { edge: number; err: number } | undefined;
    for (const k of streets) {
      const g = k.r + FRONT_TOL;
      if (Math.max(k.a.x, k.b.x) + g < Math.min(a.x, b.x) || Math.min(k.a.x, k.b.x) - g > Math.max(a.x, b.x)) continue;
      if (Math.max(k.a.y, k.b.y) + g < Math.min(a.y, b.y) || Math.min(k.a.y, k.b.y) - g > Math.max(a.y, b.y)) continue;
      const sl = Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y);
      if (sl === 0) continue;
      const cross = Math.abs(ux * (k.b.y - k.a.y) - uy * (k.b.x - k.a.x)) / sl;
      if (cross > SIN_PARALLEL) continue;
      // Any part of this edge may front k (a sub-piece's edge would): keep k for the children.
      if (segmentDistance(a, b, k.a, k.b) <= g) matched.add(k);
      const err = Math.abs(distToSegment(m, k.a, k.b) - k.r);
      if (err <= FRONT_TOL && (!best || err < best.err)) best = { edge: k.edge, err };
    }
    if (!best) continue;
    total.set(best.edge, (total.get(best.edge) ?? 0) + len);
    const l = longest.get(best.edge);
    if (!l || len > l.len) longest.set(best.edge, { a, b, len });
  }
  let pick: number | undefined;
  for (const [edge, len] of [...total].sort((x, y) => x[0] - y[0])) {
    if (pick === undefined || len > (total.get(pick) as number)) pick = edge;
  }
  const m = streets.filter((k) => matched.has(k));
  if (pick === undefined) return { frontage: undefined, matched: m };
  const length = total.get(pick) as number;
  if (length < minFrontage) return { frontage: undefined, matched: m };
  const l = longest.get(pick) as { a: Vec2; b: Vec2; len: number };
  return { frontage: { edge: pick, a: l.a, b: l.b, length }, matched: m };
}

/** Half-plane { q : (q − c) · axis <= 0 } (side -1) or >= 0 (side +1), as a big rectangle. */
function halfPlane(c: Vec2, axis: Vec2, size: number, side: -1 | 1): PcPolygon {
  const px = -axis.y;
  const py = axis.x;
  const fx = axis.x * size * side;
  const fy = axis.y * size * side;
  const pts: [number, number][] = [
    [c.x - px * size, c.y - py * size],
    [c.x + fx - px * size, c.y + fy - py * size],
    [c.x + fx + px * size, c.y + fy + py * size],
    [c.x + px * size, c.y + py * size],
  ];
  return [[...pts, pts[0] as [number, number]]];
}

/** Split p by the line through the OBB at fraction t of the long side, perpendicular to it. */
/** Undefined when polygon-clipping failed: the caller keeps the piece unsplit. */
function splitObb(p: Poly, obb: Obb, t: number): Poly[] | undefined {
  const c = {
    x: obb.center.x + obb.axis.x * (t - 0.5) * obb.long,
    y: obb.center.y + obb.axis.y * (t - 0.5) * obb.long,
  };
  if (p.holes.length === 0 && isConvex(p.outer)) {
    // Convex fast path (exact): Sutherland–Hodgman on both sides of the line.
    const neg = { x: -obb.axis.x, y: -obb.axis.y };
    return [clipHalfPlane(p.outer, c, neg), clipHalfPlane(p.outer, c, obb.axis)]
      .filter((r) => r.length >= 3 && ringArea(r) >= 1)
      .map((outer) => ({ outer, holes: [] }));
  }
  if (p.holes.length === 0) {
    const pieces = splitSimpleRing(p.outer, c, obb.axis);
    if (pieces) return pieces.filter((r) => ringArea(r) >= 1).map((outer) => ({ outer, holes: [] }));
  }
  const size = obb.long + obb.short + 10;
  const lo = intersection(p, halfPlane(c, obb.axis, size, -1), 1);
  const hi = intersection(p, halfPlane(c, obb.axis, size, 1), 1);
  return lo && hi ? [...lo, ...hi] : undefined;
}

/** Street-fronting parcels of one buildable part (unnumbered; ids are assigned by the caller). */
export function subdividePart(part: Poly, params: ParcelParams, keepOuts: KeepOutIndex, rng: Rng): { poly: Poly; area: number; frontage: Frontage }[] {
  const out: { poly: Poly; area: number; frontage: Frontage }[] = [];
  const visit = (p: Poly, depth: number, cands: readonly KeepOut[]): void => {
    const { frontage, matched } = frontageAmong(p, cands, params.minFrontage);
    if (!frontage) return;
    const obb = minAreaObb(p.outer);
    if (obb.short < params.minWidth) return;
    const area = polyArea(p);
    const t = rng.range(0.4, 0.6); // always drawn: fixed draw order per visited piece
    const wantsSplit = obb.long > params.maxSide || area > params.maxArea;
    if (!wantsSplit || obb.long < 2 * params.minSide || depth >= 40) {
      out.push({ poly: p, area, frontage });
      return;
    }
    const children = splitObb(p, obb, t);
    if (!children) {
      out.push({ poly: p, area, frontage });
      return;
    }
    for (const child of children) visit(child, depth + 1, matched);
  };
  visit(part, 0, candidateStreets(part, keepOuts));
  return out;
}
