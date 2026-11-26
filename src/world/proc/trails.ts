/**
 * Hiking trails (`procedural.trails:` in world.yaml; card 3 of docs/map-reshape/03-technical/12-sectors-and-streaming.md).
 * Pure and deterministic. A trail is a footpath from the landside of the airport terminal to a ridge viewpoint chosen
 * by a rule (never a coordinate), routed with `leastCostPath` on a grade-penalised cost:
 *
 *   cost per edge = len (1 + 2 (grade / (max_grade / 2))²), infinite above `max_grade`, in water, inside the airfield
 *   (+ a 20 m fence), on a built cell, or outside the Act 1 rect.
 *
 * Viewpoint rule: the highest dry, unbuilt cell within `highest_within` m of the airfield, inside the Act 1 rect shrunk
 * by `margin`, at least `min_distance` m (straight line) from the terminal. Candidates are tried from the highest down
 * (each at least CANDIDATE_SPACING from the ones already tried); the first one that routes within `max_length` wins.
 * When none routes the trail has no points (`found: false`) and the guard fires; generation never throws.
 */
import type { Rect } from '../geometry.ts';
import type { Vec2 } from '../vec.ts';
import { fieldDistance, type AirportResult } from './airport.ts';
import { cellAt, centreX, centreY, type FieldGrid, type MaskGrid } from './grid.ts';
import { cellsToPoints, leastCostPath, polylineLength } from './paths.ts';

export interface ViewpointRule {
  /** Search radius around the airfield (m). */
  readonly highestWithin: number;
  /** The viewpoint stays this far inside the Act 1 rect (m). */
  readonly margin: number;
  /** Straight-line distance from the start the viewpoint must be at least (m). */
  readonly minDistance: number;
}

export interface TrailParams {
  readonly id: string;
  readonly viewpoint: ViewpointRule;
  /** Footpath width (m). */
  readonly width: number;
  /** Steepest edge (rise/run). */
  readonly maxGrade: number;
  readonly minLength: number;
  readonly maxLength: number;
}

export interface TrailResult {
  readonly id: string;
  readonly width: number;
  readonly maxGrade: number;
  readonly minLength: number;
  readonly maxLength: number;
  /** Start (the generated terminal) and the viewpoint the rule chose (cell centre); the latter is the terminal when nothing routed. */
  readonly from: Vec2;
  readonly viewpoint: Vec2;
  /** Footpath: the routed cell centres, start to viewpoint; empty when no route exists. */
  readonly points: readonly Vec2[];
  readonly cells: readonly number[];
  readonly length: number;
  readonly found: boolean;
}

export interface TrailInputs {
  readonly height: FieldGrid;
  readonly land: MaskGrid;
  readonly lake: MaskGrid;
  /** River and canal cells (`wet`). */
  readonly wet: MaskGrid;
  /** Town owner per cell (0 = not built). */
  readonly built: Uint8Array;
  readonly airport: AirportResult;
  /** The Act 1 rect (game-spec `act1Rect`). */
  readonly rect: Rect;
}

export const TRAIL_FENCE_M = 20;
const CANDIDATE_SPACING = 150;
const MAX_TRIES = 24;

/** Cells that may be the viewpoint, highest first (ties by index). */
export function viewpointCandidates(inp: TrailInputs, rule: ViewpointRule): number[] {
  const { height: g, land, lake, wet, built, airport, rect } = inp;
  const t = airport.terminal;
  const out: number[] = [];
  for (let i = 0; i < g.data.length; i++) {
    if (!land.data[i] || lake.data[i] || wet.data[i] || built[i]) continue;
    const x = centreX(g, i % g.w);
    const y = centreY(g, Math.floor(i / g.w));
    if (x < rect.minX + rule.margin || x > rect.maxX - rule.margin || y < rect.minY + rule.margin || y > rect.maxY - rule.margin) continue;
    if (fieldDistance(airport, x, y) <= TRAIL_FENCE_M || fieldDistance(airport, x, y) > rule.highestWithin) continue;
    if (Math.hypot(x - t.x, y - t.y) < rule.minDistance) continue;
    out.push(i);
  }
  return out.sort((a, b) => g.data[b]! - g.data[a]! || a - b);
}

export function routeTrail(inp: TrailInputs, p: TrailParams): TrailResult {
  const { height: g } = inp;
  const hd = g.data;
  const start = cellAt(g, inp.airport.terminal.x, inp.airport.terminal.y);
  const startAt = { x: centreX(g, start % g.w), y: centreY(g, Math.floor(start / g.w)) };
  const blocked: MaskGrid = { w: g.w, h: g.h, cell: g.cell, data: new Uint8Array(g.data.length) };
  const { rect } = inp;
  for (let i = 0; i < blocked.data.length; i++) {
    const x = centreX(g, i % g.w);
    const y = centreY(g, Math.floor(i / g.w));
    const outside = x < rect.minX || x > rect.maxX || y < rect.minY || y > rect.maxY;
    blocked.data[i] = outside || !inp.land.data[i] || inp.lake.data[i] || inp.wet.data[i] || inp.built[i] || fieldDistance(inp.airport, x, y) <= TRAIL_FENCE_M ? 1 : 0;
  }
  blocked.data[start] = 0;
  const g0 = p.maxGrade / 2;
  const cost = (a: number, b: number, len: number, mid: number): number => {
    if (blocked.data[b] || blocked.data[mid]) return Number.POSITIVE_INFINITY;
    const grade = Math.abs(hd[b]! - hd[a]!) / len;
    if (grade > p.maxGrade) return Number.POSITIVE_INFINITY;
    return len * (1 + 2 * (grade / g0) ** 2);
  };
  const base = { id: p.id, width: p.width, maxGrade: p.maxGrade, minLength: p.minLength, maxLength: p.maxLength, from: inp.airport.terminal };
  let tried = 0;
  const taken: Vec2[] = [];
  for (const c of viewpointCandidates(inp, p.viewpoint)) {
    if (tried >= MAX_TRIES) break;
    const at = { x: centreX(g, c % g.w), y: centreY(g, Math.floor(c / g.w)) };
    if (taken.some((q) => Math.hypot(q.x - at.x, q.y - at.y) < CANDIDATE_SPACING)) continue;
    taken.push(at);
    tried++;
    const cells = leastCostPath(g, startAt, at, cost, 1);
    if (cells.length < 2) continue;
    // The cell centres themselves: every edge is within `max_grade` by construction. Smoothing would cut corners over
    // terrain the cost never saw, so a footpath keeps the routed vertices.
    const points = cellsToPoints(g, cells);
    const length = polylineLength(points);
    if (length > p.maxLength) continue;
    return { ...base, viewpoint: at, points, cells, length, found: true };
  }
  return { ...base, viewpoint: inp.airport.terminal, points: [], cells: [], length: 0, found: false };
}

export function routeTrails(inp: TrailInputs, params: readonly TrailParams[]): TrailResult[] {
  return params.map((p) => routeTrail(inp, p));
}
