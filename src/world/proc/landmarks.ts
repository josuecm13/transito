/**
 * Landmarks on the generated map (#12 2.3; `procedural.landmarks:` in world.yaml). Pure.
 *
 * Each landmark the procedural map places has a rule, never coordinates, so it follows the generated
 * features when they move. Act 1 landmarks hang off the Act 1 placement (act1.ts); airport landmarks
 * off the generated airfield. Town-owned spots snap to the nearest built cell of the act's town.
 *
 *   anchor                  the act1 anchor (Tito's barrio centre), moved to the nearest town cell clear of every carriageway
 *   along: m                that far along the act1 strip from the anchor (towards the branch end)
 *   steepest_within: m      the steepest built cell of the act's town within that radius of the anchor
 *   airport: terminal       the generated terminal (landside)
 *   airport: apron          the centre of the generated apron (airside)
 *   on: crossing            where the generated `route` crosses the generated canal (first crossing along the route): the
 *                           point on the road centreline, i.e. on the deck, heading along the road. `tolerance` (m) is how far
 *                           the landmark may sit from that crossing (guard `bridge-landmarks-on-crossing`). When the route no
 *                           longer crosses the canal the landmark goes to their closest approach and the guard fires.
 */
import type { Vec2 } from '../vec.ts';
import type { Act1Placement } from './act1.ts';
import { splitAt } from './act1.ts';
import type { AirportResult } from './airport.ts';
import type { FieldGrid } from './grid.ts';
import { cellAt } from './grid.ts';
import { distanceToPolyline } from '../geometry.ts';

export type LandmarkRule =
  | { readonly kind: 'anchor' }
  | { readonly kind: 'along'; readonly metres: number }
  | { readonly kind: 'steepest'; readonly within: number }
  | { readonly kind: 'airport'; readonly part: 'terminal' | 'apron' }
  | { readonly kind: 'crossing'; readonly route: string; readonly feature: 'canal'; readonly tolerance: number };

export interface PlacedLandmark {
  readonly id: string;
  readonly at: Vec2;
  /** Degrees in [0, 180), along the road at the point (crossing rules only). */
  readonly heading?: number;
  readonly rule: LandmarkRule;
}

const centreOf = (g: FieldGrid, c: number): Vec2 => ({ x: ((c % g.w) + 0.5) * g.cell, y: (Math.floor(c / g.w) + 0.5) * g.cell });

/** Nearest cell owned by `town` (index + 1 in `owner`) to p, searched in growing rings; p itself when none within `maxR`. */
export function snapToTown(p: Vec2, owner: Uint8Array, g: FieldGrid, town: number, maxR = 600): Vec2 {
  const c0 = cellAt(g, p.x, p.y);
  if (owner[c0] === town + 1) return centreOf(g, c0);
  const cx = c0 % g.w;
  const cy = Math.floor(c0 / g.w);
  let best = -1;
  let bestD = Infinity;
  const R = Math.ceil(maxR / g.cell);
  for (let r = 1; r <= R && best < 0; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) continue;
        const c = gy * g.w + gx;
        if (owner[c] !== town + 1) continue;
        const q = centreOf(g, c);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
  }
  return best < 0 ? p : centreOf(g, best);
}

/** A carriageway a landmark must stay off: its centreline and the clear distance from it (half width + margin). */
export interface RoadClearance {
  readonly points: readonly Vec2[];
  readonly clear: number;
}

/** Nearest cell of `town` to p whose centre is `clear` of every road (rings of growing radius); null when none within maxR. */
export function snapClearOfRoads(p: Vec2, owner: Uint8Array, g: FieldGrid, town: number, roads: readonly RoadClearance[], maxR = 600): Vec2 | null {
  const ok = (q: Vec2): boolean => roads.every((r) => distanceToPolyline(q, r.points as never) >= r.clear);
  const c0 = cellAt(g, p.x, p.y);
  const cx = c0 % g.w;
  const cy = Math.floor(c0 / g.w);
  const R = Math.ceil(maxR / g.cell);
  for (let r = 0; r <= R; r++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= g.w || gy >= g.h) continue;
        const c = gy * g.w + gx;
        if (owner[c] !== town + 1) continue;
        const q = centreOf(g, c);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD && ok(q)) {
          bestD = d;
          best = q;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

export interface Crossing {
  readonly at: Vec2;
  /** Degrees in [0, 180): direction of the route there. */
  readonly heading: number;
  /** False when the lines never cross: `at` is then the closest approach. */
  readonly crosses: boolean;
}

/** Where `route` first crosses `feature` (both polylines), else their closest approach (a segment end to the other line). */
export function routeCrossing(route: readonly Vec2[], feature: readonly Vec2[]): Crossing | null {
  if (route.length < 2 || feature.length < 2) return null;
  const heading = (a: Vec2, b: Vec2): number => (((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 180 + 180) % 180;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    let bestT = Infinity;
    for (let j = 1; j < feature.length; j++) {
      const c = feature[j - 1]!;
      const d = feature[j]!;
      const rx = b.x - a.x;
      const ry = b.y - a.y;
      const sx = d.x - c.x;
      const sy = d.y - c.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
      const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) bestT = t;
    }
    if (bestT < Infinity) return { at: { x: a.x + (b.x - a.x) * bestT, y: a.y + (b.y - a.y) * bestT }, heading: heading(a, b), crosses: true };
  }
  let best: Crossing | null = null;
  let bestD = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    for (const q of feature) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2));
      const p = { x: a.x + dx * t, y: a.y + dy * t };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bestD) {
        bestD = d;
        best = { at: p, heading: heading(a, b), crosses: false };
      }
    }
  }
  return best;
}

/** Slope (m/m) at cell c by central differences. */
function slopeAt(h: FieldGrid, c: number): number {
  const x = c % h.w;
  const y = Math.floor(c / h.w);
  const v = (i: number, j: number): number => h.data[Math.min(h.h - 1, Math.max(0, j)) * h.w + Math.min(h.w - 1, Math.max(0, i))]!;
  return Math.hypot(v(x + 1, y) - v(x - 1, y), v(x, y + 1) - v(x, y - 1)) / (2 * h.cell);
}

export function placeLandmarks(
  rules: readonly { id: string; rule: LandmarkRule }[],
  act1: Act1Placement,
  airport: AirportResult,
  owner: Uint8Array,
  height: FieldGrid,
  town: number,
  roads: readonly RoadClearance[] = [],
  generated: { readonly routes: readonly { readonly id: string; readonly points: readonly Vec2[] }[]; readonly canal: readonly Vec2[] } = { routes: [], canal: [] },
): PlacedLandmark[] {
  return rules.map(({ id, rule }) => {
    let at: Vec2;
    let heading: number | undefined;
    switch (rule.kind) {
      case 'anchor':
        // The barrio centre sits on the track, which runs along the highway: step off every carriageway.
        at = (roads.length ? snapClearOfRoads(act1.anchor, owner, height, town, roads) : null) ?? snapToTown(act1.anchor, owner, height, town);
        break;
      case 'along': {
        const line = act1.strip.centreline;
        const L = act1.strip.lengthM;
        at = snapToTown(line.length > 1 && L > 0 ? splitAt(line, rule.metres / L).point : act1.anchor, owner, height, town);
        break;
      }
      case 'steepest': {
        const a = act1.anchor;
        const R = Math.ceil(rule.within / height.cell);
        const c0 = cellAt(height, a.x, a.y);
        const cx = c0 % height.w;
        const cy = Math.floor(c0 / height.w);
        let best = -1;
        let bestS = -1;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const gx = cx + dx;
            const gy = cy + dy;
            if (gx < 0 || gy < 0 || gx >= height.w || gy >= height.h) continue;
            const c = gy * height.w + gx;
            if (owner[c] !== town + 1) continue;
            const q = centreOf(height, c);
            if (Math.hypot(q.x - a.x, q.y - a.y) > rule.within) continue;
            const s = slopeAt(height, c);
            if (s > bestS) {
              bestS = s;
              best = c;
            }
          }
        }
        at = best < 0 ? a : centreOf(height, best);
        break;
      }
      case 'crossing': {
        const route = generated.routes.find((r) => r.id === rule.route);
        const x = route ? routeCrossing(route.points, generated.canal) : null;
        if (!x) throw new Error(`landmark ${id}: route "${rule.route}" has no generated line to cross`);
        at = x.at;
        heading = x.heading;
        break;
      }
      case 'airport': {
        if (rule.part === 'terminal') at = airport.terminal;
        else {
          const ring = airport.apronRing;
          at = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
        }
        break;
      }
    }
    return { id, at, rule, ...(heading !== undefined ? { heading } : {}) };
  });
}
