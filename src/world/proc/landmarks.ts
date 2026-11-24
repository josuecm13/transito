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
  | { readonly kind: 'airport'; readonly part: 'terminal' | 'apron' };

export interface PlacedLandmark {
  readonly id: string;
  readonly at: Vec2;
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
): PlacedLandmark[] {
  return rules.map(({ id, rule }) => {
    let at: Vec2;
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
      case 'airport': {
        if (rule.part === 'terminal') at = airport.terminal;
        else {
          const ring = airport.apronRing;
          at = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length };
        }
        break;
      }
    }
    return { id, at, rule };
  });
}
