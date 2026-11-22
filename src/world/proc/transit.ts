/**
 * Metro lines and the interoceanic railway. Each line is a list of stops (terminals, interchanges,
 * via points); the track between stops is a least-cost path that prefers built-up ground and existing
 * main roads (a metro follows the avenues; the railway follows the highway corridor), with a grade
 * penalty and bridges over water. Stations are placed along the track at a target spacing; stops
 * shared by several lines become interchange stations.
 */
import type { Vec2 } from '../vec.ts';
import { type FieldGrid, type MaskGrid } from './grid.ts';
import { leastCostPath, polylineLength, smoothAvoiding } from './paths.ts';
import { snapToDry } from './roads.ts';

export interface TransitLineSpec {
  readonly id: string;
  readonly name: string;
  readonly mode: 'metro' | 'rail';
  readonly color: readonly [number, number, number];
  /** Branches: each is an ordered list of stops. A line may have several branches (same colour). */
  readonly branches: readonly (readonly Vec2[])[];
  /** Target distance between stations (m). */
  readonly stationSpacing: number;
}

export interface TransitParams {
  readonly lines: readonly TransitLineSpec[];
  /** Cost multiplier per metre off built-up ground (metro) / away from main roads (rail). */
  readonly offUrban: number;
  readonly offRoad: number;
  readonly grade: { readonly metro: number; readonly rail: number };
  readonly bridge: number;
  /** Stops of different lines closer than this (m) are one interchange station. */
  readonly interchangeRadius: number;
}

export interface Station {
  readonly at: Vec2;
  readonly lines: readonly string[];
  readonly interchange: boolean;
  readonly terminal: boolean;
}

export interface TransitLine {
  readonly id: string;
  readonly name: string;
  readonly mode: 'metro' | 'rail';
  readonly color: readonly [number, number, number];
  readonly tracks: readonly (readonly Vec2[])[];
}

export interface TransitResult {
  readonly lines: readonly TransitLine[];
  readonly stations: readonly Station[];
}

function pointAt(pts: readonly Vec2[], dist: number): Vec2 {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + l >= dist) {
      const t = l === 0 ? 0 : (dist - acc) / l;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += l;
  }
  return pts[pts.length - 1]!;
}

export function routeTransit(height: FieldGrid, land: MaskGrid, lake: MaskGrid, wet: MaskGrid, urban: FieldGrid, roads: MaskGrid, p: TransitParams): TransitResult {
  const hd = height.data;
  const lines: TransitLine[] = [];
  const stops: { at: Vec2; line: string; terminal: boolean }[] = [];
  const spaced: { at: Vec2; line: string }[] = [];
  for (const spec of p.lines) {
    const metro = spec.mode === 'metro';
    const g0 = metro ? p.grade.metro : p.grade.rail;
    const cost = (a: number, b: number, len: number, mid: number): number => {
      if (lake.data[b] || lake.data[mid]) return Number.POSITIVE_INFINITY;
      const water = !land.data[b] || wet.data[b] || wet.data[mid];
      const grade = water ? 0 : Math.abs(Math.max(0, hd[b]!) - Math.max(0, hd[a]!)) / len;
      let c = len * (1 + 3 * (grade / g0) ** 2);
      if (water) c *= !land.data[b] ? p.bridge * 40 : wet.data[b] === 2 || wet.data[mid] === 2 ? p.bridge * 8 : p.bridge;
      if (metro && urban.data[b]! <= 0) c *= p.offUrban;
      if (!roads.data[b]) c *= metro ? 1.6 : p.offRoad;
      return c;
    };
    const tracks: Vec2[][] = [];
    for (const branch of spec.branches) {
      const snapped = branch.map((s) => snapToDry(land, lake, wet, s));
      // Each leg is smoothed on its own so every stop stays a vertex of the track.
      const track: Vec2[] = [];
      for (let s = 1; s < snapped.length; s++) {
        const leg = leastCostPath(height, snapped[s - 1]!, snapped[s]!, cost, 1);
        if (leg.length === 0) throw new Error(`routeTransit: ${spec.id} leg ${s} unreachable`);
        const pts = smoothAvoiding(height, leg, lake, snapped[s - 1]!, snapped[s]!);
        track.push(...(track.length ? pts.slice(1) : pts));
      }
      tracks.push(track);
      snapped.forEach((at, k) => stops.push({ at, line: spec.id, terminal: k === 0 || k === snapped.length - 1 }));
      // Intermediate stations at even spacing, skipping those too close to a stop.
      const len = polylineLength(track);
      const count = Math.max(0, Math.round(len / spec.stationSpacing) - 1);
      for (let k = 1; k <= count; k++) {
        const at = pointAt(track, (len * k) / (count + 1));
        if (snapped.every((s) => Math.hypot(s.x - at.x, s.y - at.y) > spec.stationSpacing * 0.45)) spaced.push({ at, line: spec.id });
      }
    }
    lines.push({ id: spec.id, name: spec.name, mode: spec.mode, color: spec.color, tracks });
  }
  // Merge stops into stations; stops of different lines within the radius are an interchange.
  const stations: { at: Vec2; lines: Set<string>; terminal: boolean }[] = [];
  for (const s of stops) {
    const hit = stations.find((t) => Math.hypot(t.at.x - s.at.x, t.at.y - s.at.y) <= p.interchangeRadius);
    if (hit) {
      hit.lines.add(s.line);
      hit.terminal = hit.terminal && s.terminal;
    } else stations.push({ at: s.at, lines: new Set([s.line]), terminal: s.terminal });
  }
  for (const s of spaced) {
    if (stations.some((t) => Math.hypot(t.at.x - s.at.x, t.at.y - s.at.y) <= p.interchangeRadius)) continue;
    stations.push({ at: s.at, lines: new Set([s.line]), terminal: false });
  }
  return {
    lines,
    stations: stations.map((s) => ({ at: s.at, lines: [...s.lines].sort(), interchange: s.lines.size > 1, terminal: s.terminal })),
  };
}
