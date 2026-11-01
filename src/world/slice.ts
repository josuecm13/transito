import type { Landmark, WorldSpec } from './spec.ts';
import type { Vec2 } from './vec.ts';
import type { Rect } from './geometry.ts';
import {
  clipPolylineToRect,
  clipSegmentToRect,
  pointInPolygon,
  polylineXAtY,
  rectContains,
  segmentsOfPolygon,
} from './geometry.ts';

export interface Street {
  routeId: string;
  kind: string;
  centerline: Vec2[];
  width: number;
  sidewalk: number;
}

export interface WorldSlice {
  rect: Rect;
  landmarks: Landmark[];
  /** Player start landmark (active_area.spawn). */
  spawn: Landmark;
  streets: Street[];
  walls: [Vec2, Vec2][];
  isPlayableLand(p: Vec2): boolean;
}

export function sliceWorld(spec: WorldSpec): WorldSlice {
  const { x, y } = spec.activeArea;
  const rect: Rect = { minX: x[0], maxX: x[1], minY: y[0], maxY: y[1] };

  const landmarks = spec.landmarks.filter((l) => rectContains(rect, l.position));

  const spawn = spec.landmarks.find((l) => l.id === spec.activeArea.spawn);
  if (!spawn) throw new Error(`active_area.spawn "${spec.activeArea.spawn}" is not a landmark`);

  const streets: Street[] = [];
  for (const route of spec.routes) {
    const profile = spec.streetProfiles[route.kind];
    const width = route.width ?? profile?.width;
    if (width === undefined) continue; // parseWorldSpec guarantees this cannot happen
    for (const centerline of clipPolylineToRect(route.points, rect)) {
      streets.push({
        routeId: route.id,
        kind: route.kind,
        centerline,
        width,
        sidewalk: profile?.sidewalk ?? 0,
      });
    }
  }

  const walls: [Vec2, Vec2][] = [];
  for (const [a, b] of segmentsOfPolygon(spec.land)) {
    const c = clipSegmentToRect(a, b, rect);
    if (c) walls.push(c);
  }
  for (const line of [spec.playableBoundary.west, spec.playableBoundary.east]) {
    for (const piece of clipPolylineToRect(line, rect)) {
      for (let i = 0; i < piece.length - 1; i++) walls.push([piece[i] as Vec2, piece[i + 1] as Vec2]);
    }
  }
  const sw = { x: rect.minX, y: rect.minY };
  const se = { x: rect.maxX, y: rect.minY };
  const ne = { x: rect.maxX, y: rect.maxY };
  const nw = { x: rect.minX, y: rect.maxY };
  walls.push([sw, se], [se, ne], [ne, nw], [nw, sw]);

  const isPlayableLand = (p: Vec2): boolean => {
    if (!rectContains(rect, p) || !pointInPolygon(p, spec.land)) return false;
    const west = polylineXAtY(spec.playableBoundary.west, p.y);
    if (west !== undefined && p.x < west) return false;
    const east = polylineXAtY(spec.playableBoundary.east, p.y);
    if (east !== undefined && p.x > east) return false;
    return true;
  };

  return { rect, landmarks, spawn, streets, walls, isPlayableLand };
}
