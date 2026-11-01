/**
 * Where the car is parked at the start (C1): a spot on a drivable street edge near the spawn,
 * aligned with the street, on the right-hand kerb (Panama drives on the right), clear of buildings
 * and of every other carriageway. Pure and deterministic: candidates are sorted by distance, ties
 * by edge id and side.
 */
import type { Vec2 } from './vec.ts';
import { buildingCorners } from './blockout.ts';
import type { Building } from './blockout.ts';
import { distanceToSegment } from './geometry.ts';
import type { GraphSnapshot } from './streets/planar-graph.ts';

export interface ParkingOptions {
  /** Car footprint, meters. */
  length: number;
  width: number;
  /** Gap kept between the car and the kerb line, and around buildings, meters. */
  kerbGap: number;
  buildingMargin: number;
  /** Distance range from the origin, meters. */
  minDistance: number;
  maxDistance: number;
  /** Candidate spacing along an edge, meters. */
  step: number;
  /** Free road kept between the car's ends and the edge ends (junctions), meters. */
  junctionClear: number;
}

export const DEFAULT_PARKING: ParkingOptions = {
  length: 4.2,
  width: 1.8,
  kerbGap: 0.3,
  buildingMargin: 0.4,
  minDistance: 6,
  maxDistance: 40,
  step: 1,
  junctionClear: 4,
};

export interface ParkingSpot {
  /** Car centre, spec plane. */
  position: Vec2;
  /** Unit heading, spec plane (the car's nose). */
  heading: Vec2;
  /** Edge it is parked on. */
  edge: number;
}

/** Corners of the car footprint (length along `heading`), grown by `margin` on every side. */
export function carFootprint(center: Vec2, heading: Vec2, o: Pick<ParkingOptions, 'length' | 'width'>, margin = 0): Vec2[] {
  return buildingCorners({ center, width: o.length + 2 * margin, depth: o.width + 2 * margin, angle: Math.atan2(heading.y, heading.x) });
}

/** Separating-axis test for two convex polygons (touching counts as separate). */
export function polygonsOverlap(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Vec2;
      const q = poly[(i + 1) % poly.length] as Vec2;
      const ax = q.y - p.y;
      const ay = p.x - q.x;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const c of a) {
        const d = c.x * ax + c.y * ay;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const c of b) {
        const d = c.x * ax + c.y * ay;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

const DRIVABLE = new Set(['avenue', 'collector', 'local']);

export function findParkingSpot(
  graph: GraphSnapshot,
  buildings: readonly Pick<Building, 'center' | 'width' | 'depth' | 'angle'>[],
  origin: Vec2,
  options: Partial<ParkingOptions> = {},
): ParkingSpot | undefined {
  const o = { ...DEFAULT_PARKING, ...options };
  const halfDiag = Math.hypot(o.length, o.width) / 2 + o.buildingMargin;
  const streets = graph.edges.filter((e) => DRIVABLE.has(e.cls));
  const node = (i: number): Vec2 => graph.nodes[i] as Vec2;

  type Cand = { dist: number; edge: number; side: number; spot: ParkingSpot; corners: Vec2[] };
  const cands: Cand[] = [];
  for (const e of streets) {
    const a = node(e.a);
    const b = node(e.b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const margin = o.length / 2 + o.junctionClear;
    if (len < 2 * margin) continue;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const offset = e.width / 2 - o.width / 2 - o.kerbGap;
    if (offset < 0) continue; // street too narrow for the car
    for (const side of [0, 1]) {
      // side 0 travels a -> b, side 1 b -> a; the car sits on the right of its heading.
      const heading = side === 0 ? dir : { x: -dir.x, y: -dir.y };
      const right = { x: heading.y, y: -heading.x };
      for (let s = margin; s <= len - margin + 1e-9; s += o.step) {
        const c = { x: a.x + dir.x * s + right.x * offset, y: a.y + dir.y * s + right.y * offset };
        const dist = Math.hypot(c.x - origin.x, c.y - origin.y);
        if (dist < o.minDistance || dist > o.maxDistance) continue;
        cands.push({ dist, edge: e.id, side, spot: { position: c, heading, edge: e.id }, corners: carFootprint(c, heading, o) });
      }
    }
  }
  cands.sort((p, q) => p.dist - q.dist || p.edge - q.edge || p.side - q.side);

  for (const c of cands) {
    const grown = carFootprint(c.spot.position, c.spot.heading, o, o.buildingMargin);
    let clear = true;
    for (const bd of buildings) {
      if (Math.hypot(bd.center.x - c.spot.position.x, bd.center.y - c.spot.position.y) > Math.hypot(bd.width, bd.depth) / 2 + halfDiag) continue;
      if (polygonsOverlap(grown, buildingCorners(bd))) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    // Do not sit on another carriageway (side streets, junction mouths).
    for (const e of streets) {
      if (e.id === c.edge) continue;
      const a = node(e.a);
      const b = node(e.b);
      if (c.corners.some((p) => distanceToSegment(p, a, b) < e.width / 2 + 0.5)) {
        clear = false;
        break;
      }
    }
    if (clear) return c.spot;
  }
  return undefined;
}
