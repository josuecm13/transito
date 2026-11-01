/**
 * Brute-force validators for deriveCity (issue #7, S5), independent of the src spatial index and
 * of src/world/streets/poly.ts predicates. Not a test file itself: imported by
 * tests/streets-parcels*.test.ts.
 */
import pc from 'polygon-clipping';
import type { Polygon as PcPolygon } from 'polygon-clipping';
import type { GraphSnapshot } from '../src/world/streets/planar-graph.ts';
import type { City, Poly } from '../src/world/streets/index.ts';
import { buildingCorners } from '../src/world/blockout.ts';
import { pointInPolygon } from '../src/world/geometry.ts';
import type { Vec2 } from '../src/world/vec.ts';
import { pointSegmentDistance, segmentsIntersect } from './streets-check.ts';

const closed = (r: readonly Vec2[]): [number, number][] => [...r, r[0] as Vec2].map((p) => [p.x, p.y]);
export const toPc = (p: Poly): PcPolygon => [closed(p.outer), ...p.holes.map(closed)];

export function multiArea(m: [number, number][][][]): number {
  let s = 0;
  for (const poly of m) {
    poly.forEach((ring, i) => {
      let a = 0;
      for (let k = 0; k < ring.length - 1; k++) a += ring[k]![0] * ring[k + 1]![1] - ring[k + 1]![0] * ring[k]![1];
      s += (i === 0 ? 1 : -1) * Math.abs(a / 2);
    });
  }
  return s;
}

export function segDist(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d).d, pointSegmentDistance(b, c, d).d, pointSegmentDistance(c, a, b).d, pointSegmentDistance(d, a, b).d);
}

const inPoly = (q: Vec2, p: Poly) => pointInPolygon(q, p.outer) && !p.holes.some((h) => pointInPolygon(q, h));

/** Building rectangle strictly inside poly: corners inside, no edge touching any poly edge. */
export function rectStrictlyInside(corners: readonly Vec2[], p: Poly): boolean {
  if (!corners.every((q) => inPoly(q, p))) return false;
  const edges: [Vec2, Vec2][] = [];
  for (const r of [p.outer, ...p.holes]) for (let i = 0; i < r.length; i++) edges.push([r[i]!, r[(i + 1) % r.length]!]);
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    for (const [c, d] of edges) if (segmentsIntersect(a, b, c, d)) return false;
  }
  return true;
}

/** Buildings closer than width/2 + sidewalk to any street edge (frame edges excluded). */
export function buildingsOnStreets(city: City, g: GraphSnapshot): string[] {
  const bad: string[] = [];
  const streets = g.edges.filter((e) => e.cls !== 'frame').map((e) => ({ e, a: g.nodes[e.a] as Vec2, b: g.nodes[e.b] as Vec2, r: e.width / 2 + e.sidewalk }));
  city.buildings.forEach((bld, i) => {
    const c = buildingCorners(bld);
    const xs = c.map((p) => p.x);
    const ys = c.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (const s of streets) {
      if (Math.max(s.a.x, s.b.x) + s.r < minX || Math.min(s.a.x, s.b.x) - s.r > maxX) continue;
      if (Math.max(s.a.y, s.b.y) + s.r < minY || Math.min(s.a.y, s.b.y) - s.r > maxY) continue;
      let d = Infinity;
      for (let k = 0; k < 4; k++) d = Math.min(d, segDist(c[k]!, c[(k + 1) % 4]!, s.a, s.b));
      if (pointInPolygon(s.a, c) || pointInPolygon(s.b, c)) d = 0;
      if (d < s.r - 1e-6) bad.push(`building ${i} is ${d.toFixed(3)} m from edge ${s.e.id} (${s.e.cls}, needs ${s.r})`);
    }
  });
  return bad;
}

/** Each building strictly inside its own parcel and overlapping no other parcel. */
export function buildingsInParcels(city: City): string[] {
  const bad: string[] = [];
  const byBlock = new Map<number, number[]>();
  for (const p of city.parcels) byBlock.set(p.block, [...(byBlock.get(p.block) ?? []), p.id]);
  city.buildings.forEach((b, i) => {
    const corners = buildingCorners(b);
    const own = city.parcels[b.parcel];
    if (!own || own.id !== b.parcel) return void bad.push(`building ${i}: unknown parcel ${b.parcel}`);
    if (!rectStrictlyInside(corners, own.poly)) bad.push(`building ${i} not strictly inside parcel ${own.id}`);
    const rect: PcPolygon = [closed(corners)];
    let overlaps = 0;
    for (const id of byBlock.get(b.block) ?? []) {
      if (multiArea(pc.intersection(rect, toPc(city.parcels[id]!.poly))) > 1e-6) overlaps++;
    }
    if (overlaps !== 1) bad.push(`building ${i} overlaps ${overlaps} parcels`);
  });
  return bad;
}

const snapMm = (g: PcPolygon): PcPolygon => g.map((r) => r.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as [number, number]));

/**
 * Area of subject − clips. polygon-clipping can throw on near-degenerate input (a parcel edge lying
 * on the buildable boundary); the op is then redone with every coordinate on a 1 mm grid, which
 * moves each vertex by <= 0.71 mm (an error far below the 1e-3·area tolerance used here). If the
 * snapped op throws too, the error propagates: the check fails rather than passing silently.
 */
export function differenceArea(subject: PcPolygon, clips: readonly PcPolygon[]): number {
  try {
    return multiArea(pc.difference(subject, ...clips));
  } catch {
    return multiArea(pc.difference(snapMm(subject), ...clips.map(snapMm)));
  }
}

/** Parcels not contained in their block's buildable area (area outside > 1e-3 of the parcel). */
export function parcelsOutsideBuildable(city: City): string[] {
  const bad: string[] = [];
  for (const p of city.parcels) {
    const parts = city.buildable[p.block]!.parts.map(toPc);
    const out = parts.length === 0 ? p.area : differenceArea(toPc(p.poly), parts);
    if (out > 1e-3 * p.area + 1e-3) bad.push(`parcel ${p.id}: ${out.toFixed(4)} m² outside buildable of block ${p.block}`);
  }
  return bad;
}

/** Frontage on a real street: edge not frame, frontage segment is a parcel edge at the street's buffer line. */
export function badFrontages(city: City, g: GraphSnapshot, margin = 0.05, minFrontage = 3): string[] {
  const bad: string[] = [];
  for (const p of city.parcels) {
    const f = p.frontage;
    const e = g.edges[f.edge];
    if (!e || e.cls === 'frame') {
      bad.push(`parcel ${p.id}: frontage edge ${f.edge} is ${e ? 'a frame edge' : 'missing'}`);
      continue;
    }
    const ring = p.poly.outer.concat(...p.poly.holes);
    const isVertex = (q: Vec2) => ring.some((v) => v.x === q.x && v.y === q.y);
    if (!isVertex(f.a) || !isVertex(f.b)) bad.push(`parcel ${p.id}: frontage segment is not a parcel edge`);
    const m = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
    const d = pointSegmentDistance(m, g.nodes[e.a] as Vec2, g.nodes[e.b] as Vec2).d;
    const r = e.width / 2 + e.sidewalk + margin;
    if (Math.abs(d - r) > 0.5) bad.push(`parcel ${p.id}: frontage ${d.toFixed(2)} m from edge ${e.id}, buffer line at ${r}`);
    if (!(f.length >= minFrontage)) bad.push(`parcel ${p.id}: frontage length ${f.length}`);
  }
  return bad;
}

/** Distance from point to a convex building footprint (0 inside). */
export function distToFootprint(q: Vec2, corners: readonly Vec2[]): number {
  if (pointInPolygon(q, corners)) return 0;
  let d = Infinity;
  for (let i = 0; i < corners.length; i++) d = Math.min(d, pointSegmentDistance(q, corners[i]!, corners[(i + 1) % corners.length]!).d);
  return d;
}
