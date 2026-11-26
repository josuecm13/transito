/**
 * Invariants of a generated map (#13 step 6). Each returns a violation message or nothing; `validate`
 * reports them all, and an edit that breaks one is refused (the last valid state is kept). Every guard has a
 * mutation test (tests/studio-guards.test.ts): break the thing it protects → red.
 */
import { fieldDistance } from '../world/proc/airport.ts';
import { act1Rect } from '../world/proc/game-spec.ts';
import { sample } from '../world/proc/grid.ts';
import { TRAIL_FENCE_M } from '../world/proc/trails.ts';
import type { Isthmus } from '../world/proc/isthmus.ts';
import { routeCrossing } from '../world/proc/landmarks.ts';
import { AIRPORT_TERMINAL_STOP, type ProceduralSpec } from '../world/spec.ts';
import type { Vec2 } from '../world/vec.ts';
import { metricsOf, type Metrics } from './metrics.ts';

export interface Violation {
  readonly guard: string;
  readonly message: string;
}

export interface GuardContext {
  readonly iso: Isthmus;
  readonly config: ProceduralSpec;
  readonly metrics: Metrics;
}

/** Línea 2's director-approved interpretation (#12 open question): two branches, endpoints fixed. Edits may move stops, not reshape this. */
export const PROTECTED_LINEA_2 = { id: 'linea-2', branchEnds: [['balboa', 'bay-east'], ['north', AIRPORT_TERMINAL_STOP]] } as const;

const cellOf = (iso: Isthmus, p: Vec2): number => {
  const { w, h, cell } = iso.height;
  const x = Math.min(w - 1, Math.max(0, Math.floor(p.x / cell)));
  const y = Math.min(h - 1, Math.max(0, Math.floor(p.y / cell)));
  return y * w + x;
};
const isSea = (iso: Isthmus, i: number): boolean => !iso.relief.land.data[i];
const isWater = (iso: Isthmus, i: number): boolean => isSea(iso, i) || !!iso.lake.lake.data[i] || !!iso.canal.channel.data[i];

function ringDist(p: Vec2, ring: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    d = Math.min(d, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return d;
}

/**
 * How far a route or track end may sit from its authored stop (m). Stops in water are snapped to the nearest dry cell
 * (the authored `gamboa` stop already sits ~175 m inside the flood zone: 170 m at 20 m cells, 180 m at 40 m); flooding more
 * pushes it further (lake 5.8 km²: 210 m / 251 m). Metres, not cells: a cell-scaled tolerance made verdicts depend on the
 * preview cell (the unedited map failed at 20 m).
 */
export const ROUTE_END_TOLERANCE_M = 200;

type Guard = (c: GuardContext) => string | undefined;

function components(mask: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(mask.length);
  let n = 0;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    n++;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
        if (j >= 0 && mask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return n;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function nearWater(iso: Isthmus, p: Vec2, r: number): boolean {
  const { w, h } = iso.height;
  const c = cellOf(iso, p);
  const cx = c % w;
  const cy = Math.floor(c / w);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < w && y < h && isWater(iso, y * w + x)) return true;
    }
  return false;
}

export const GUARDS: Readonly<Record<string, Guard>> = {
  'reservoir-connected': ({ iso }) => {
    const n = components(iso.lake.lake.data, iso.height.w, iso.height.h);
    return n === 1 ? undefined : `the reservoir is ${n === 0 ? 'empty' : `${n} separate bodies of water`}`;
  },
  'rivers-drain': ({ iso }) => {
    const bad: number[] = [];
    const r = 3;
    const ends = iso.rivers.map((s) => s.points[s.points.length - 1]!);
    iso.rivers.forEach((s, k) => {
      const end = ends[k]!;
      const cell = iso.height.cell;
      const joins = iso.rivers.some((o, j) => j !== k && o.points.some((q) => Math.hypot(q.x - end.x, q.y - end.y) <= r * cell));
      const atField = ringDist(end, iso.airport.field) <= 3 * cell;
      if (!nearWater(iso, end, r) && !joins && !atField) bad.push(k);
    });
    return bad.length ? `${bad.length} river(s) end on dry land without reaching the sea, the reservoir, the canal or another river (first: #${bad[0]})` : undefined;
  },
  'canal-connects-seas': ({ iso }) => {
    const c = iso.canal.centreline;
    if (c.length < 2) return 'the canal has no centreline';
    const a = c[0]!;
    const b = c[c.length - 1]!;
    if (!isSea(iso, cellOf(iso, a)) || !isSea(iso, cellOf(iso, b))) return 'the canal does not start and end in open sea';
    const gap = c.findIndex((q, k) => k > 0 && Math.hypot(q.x - c[k - 1]!.x, q.y - c[k - 1]!.y) > 600);
    if (gap > 0) return `the canal centreline breaks at point ${gap}`;
    if (!c.some((q) => iso.lake.lake.data[cellOf(iso, q)])) return 'the canal does not pass through the reservoir';
    return undefined;
  },
  'no-towns-on-water': ({ iso }) => {
    let n = 0;
    for (let i = 0; i < iso.towns.owner.length; i++) if (iso.towns.owner[i] && isWater(iso, i)) n++;
    return n ? `${n} built cell(s) on water` : undefined;
  },
  'no-runways-on-water': ({ iso }) => {
    for (const rw of iso.airport.runways)
      for (const t of [0, 0.5, 1]) {
        const i = cellOf(iso, { x: rw.a.x + (rw.b.x - rw.a.x) * t, y: rw.a.y + (rw.b.y - rw.a.y) * t });
        if (isWater(iso, i)) return 'a runway touches water';
      }
    return undefined;
  },
  'airport-buffer': ({ metrics, config, iso }) =>
    metrics.airportToTownM >= config.towns.airportBuffer - iso.height.cell
      ? undefined
      : `the nearest built cell is ${metrics.airportToTownM} m from the airfield; the buffer is ${config.towns.airportBuffer} m`,
  'airport-detached-from-core': ({ metrics }) =>
    metrics.airportToDenseCoreM >= 250 ? undefined : `the dense core reaches ${metrics.airportToDenseCoreM} m from the airfield (needs ≥ 250 m)`,
  'districts-airport-gap': ({ metrics, config }) =>
    metrics.airportToDistrictCoreM === null || metrics.airportToDistrictCoreM >= config.districts.airportCoreGap
      ? undefined
      : `a dense district core (density ≥ 0.5) reaches ${metrics.airportToDistrictCoreM} m from the airfield; the gap is ${config.districts.airportCoreGap} m`,
  'transport-crosses-water-only-on-bridges': ({ iso }) => {
    for (const p of iso.roads.paths)
      for (const c of p.cells) {
        if (iso.lake.lake.data[c]) return `${p.id} runs through the reservoir`;
        if (isSea(iso, c)) return `${p.id} runs through the open sea`;
      }
    for (const l of iso.transit.lines)
      for (const t of l.tracks)
        for (const q of t) {
          const i = cellOf(iso, q);
          if (iso.lake.lake.data[i]) return `${l.id} runs through the reservoir`;
          if (isSea(iso, i)) return `${l.id} runs through the open sea`;
        }
    return undefined;
  },
  'routes-connected': ({ iso, config }) => {
    const tol = ROUTE_END_TOLERANCE_M;
    const stopAt = (stops: Readonly<Record<string, Vec2>>, id: string): Vec2 => (id === AIRPORT_TERMINAL_STOP ? iso.airport.terminal : stops[id]!);
    for (const rt of config.roads.routes) {
      const p = iso.roads.paths.find((x) => x.id === rt.id);
      if (!p || p.points.length < 2) return `route ${rt.id} has no path`;
      const [first, last] = [stopAt(config.roads.stops, rt.stops[0]!), stopAt(config.roads.stops, rt.stops[rt.stops.length - 1]!)];
      const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
      if (!near(p.points[0]!, first) || !near(p.points[p.points.length - 1]!, last)) return `route ${rt.id} does not reach its end stops`;
    }
    for (const l of config.transit.lines) {
      const got = iso.transit.lines.find((x) => x.id === l.id);
      if (!got || got.tracks.length !== l.branches.length || got.tracks.some((t) => t.length < 2)) return `line ${l.id} has a branch without a track`;
      for (let k = 0; k < l.branches.length; k++) {
        const ids = l.branches[k]!;
        const t = got.tracks[k]!;
        const ends = [stopAt(config.transit.stops, ids[0]!), stopAt(config.transit.stops, ids[ids.length - 1]!)];
        if (Math.hypot(t[0]!.x - ends[0]!.x, t[0]!.y - ends[0]!.y) > tol || Math.hypot(t[t.length - 1]!.x - ends[1]!.x, t[t.length - 1]!.y - ends[1]!.y) > tol)
          return `line ${l.id} branch ${k} does not reach its end stops`;
      }
    }
    return undefined;
  },
  'linea-2-unchanged': ({ config }) => {
    const l = config.transit.lines.find((x) => x.id === PROTECTED_LINEA_2.id);
    if (!l) return 'Línea 2 is missing';
    if (l.branches.length !== PROTECTED_LINEA_2.branchEnds.length) return `Línea 2 has ${l.branches.length} branches; the approved reading has ${PROTECTED_LINEA_2.branchEnds.length} (open question #12)`;
    for (let k = 0; k < l.branches.length; k++) {
      const b = l.branches[k]!;
      const [from, to] = PROTECTED_LINEA_2.branchEnds[k]!;
      if (b[0] !== from || b[b.length - 1] !== to) return `Línea 2 branch ${k} must run ${from} → ${to} (open question #12)`;
    }
    return undefined;
  },
  'airport-pad-floats': ({ iso, config }) => {
    const s = config.airport.gradeSlopeMax;
    const reach = config.airport.gradeReachMax;
    if (!(s > 0)) return 'airport.grade_slope_max is 0 (the legacy fixed 150 m blend): the pad ends in cliffs; use a slope above 0';
    const { w, h, cell, data } = iso.height;
    const nat = iso.relief.height.data;
    const a = iso.airport;
    const dist = (i: number) => fieldDistance(a, ((i % w) + 0.5) * cell, (Math.floor(i / w) + 0.5) * cell);
    let worst = 0;
    let at = -1;
    let drift = 0;
    let driftAt = -1;
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const i = gy * w + gx;
        const d = dist(i);
        if (d >= reach) continue;
        if (d >= reach - cell && Math.abs(data[i]! - nat[i]!) / cell > drift) {
          drift = Math.abs(data[i]! - nat[i]!) / cell;
          driftAt = i;
        }
        if (d >= reach * 0.75) continue;
        for (const [ox, oy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
          const x = gx + ox;
          const y = gy + oy;
          if (x >= w || y < 0 || y >= h) continue;
          const j = y * w + x;
          if (dist(j) >= reach * 0.75) continue;
          const slope = Math.abs(data[j]! - data[i]!) / (cell * Math.hypot(ox, oy));
          if (slope > worst) {
            worst = slope;
            at = i;
          }
        }
      }
    }
    const tol = 1.02;
    const where = (i: number) => `(${(((i % w) + 0.5) * cell).toFixed(0)}, ${((Math.floor(i / w) + 0.5) * cell).toFixed(0)})`;
    if (worst > s * tol) return `the airfield embankment is ${worst.toFixed(2)} m/m steep at ${where(at)} (limit ${s}): the pad floats above its surroundings`;
    if (drift > s * tol) return `the airfield grading stops ${(drift * cell).toFixed(0)} m off the natural ground at ${where(driftAt)}: grade_reach_max ${reach} m is too short`;
    return undefined;
  },
  'bridge-landmarks-on-crossing': ({ iso }) => {
    for (const l of iso.landmarks) {
      const r = l.rule;
      if (r.kind !== 'crossing') continue;
      const route = iso.roads.paths.find((p) => p.id === r.route);
      const x = route ? routeCrossing(route.points, iso.canal.centreline) : null;
      if (!x?.crosses) return `bridge landmark ${l.id}: the generated route ${r.route} does not cross the canal`;
      const d = Math.hypot(l.at.x - x.at.x, l.at.y - x.at.y);
      if (d > r.tolerance) return `bridge landmark ${l.id} is ${d.toFixed(0)} m from where ${r.route} crosses the canal (${x.at.x.toFixed(0)}, ${x.at.y.toFixed(0)}); the limit is ${r.tolerance} m`;
    }
    return undefined;
  },
  'trail-connected-and-grade': ({ iso, config }) => {
    // Hiking trails (card 3, docs/map-reshape/03-technical/12-sectors-and-streaming.md 8.3). The rect is recomputed here,
    // independently of the router, from the same Act 1 placement the game reads.
    const { w, h, cell } = iso.height;
    const rect = act1Rect(iso, config.game.rectMargin, { width: w * cell, height: h * cell });
    const inRect = (q: Vec2, m = 0): boolean => q.x >= rect.minX + m && q.x <= rect.maxX - m && q.y >= rect.minY + m && q.y <= rect.maxY - m;
    const tol = Math.max(60, 2 * cell);
    for (const spec of config.trails) {
      const t = iso.trails.find((x) => x.id === spec.id);
      const id = spec.id;
      if (!t || !t.found || t.points.length < 2) return `trail ${id}: no route from the terminal to a viewpoint (max_grade ${spec.maxGrade} may be too steep, or max_length ${spec.maxLength} m too short)`;
      const first = t.points[0]!;
      const last = t.points[t.points.length - 1]!;
      const term = iso.airport.terminal;
      if (Math.hypot(first.x - term.x, first.y - term.y) > tol) return `trail ${id} starts ${Math.hypot(first.x - term.x, first.y - term.y).toFixed(0)} m from the airport terminal (limit ${tol} m)`;
      const vp = t.viewpoint;
      if (Math.hypot(last.x - vp.x, last.y - vp.y) > cell) return `trail ${id} ends ${Math.hypot(last.x - vp.x, last.y - vp.y).toFixed(0)} m from its viewpoint`;
      // The viewpoint obeys its rule: dry, inside the Act 1 rect (shrunk by margin), near the airfield, far enough from the start.
      const v = spec.viewpoint;
      if (Math.hypot(vp.x - term.x, vp.y - term.y) < v.minDistance) return `trail ${id}: the viewpoint is ${Math.hypot(vp.x - term.x, vp.y - term.y).toFixed(0)} m from the terminal; the rule needs at least ${v.minDistance} m`;
      if (fieldDistance(iso.airport, vp.x, vp.y) > v.highestWithin) return `trail ${id}: the viewpoint is farther than ${v.highestWithin} m from the airfield`;
      if (!inRect(vp, v.margin)) return `trail ${id}: the viewpoint is not inside the Act 1 rect shrunk by ${v.margin} m`;
      let worst = 0;
      let worstAt = first;
      for (let k = 0; k < t.points.length; k++) {
        const q = t.points[k]!;
        if (!inRect(q)) return `trail ${id} leaves the Act 1 rect at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`;
        const i = cellOf(iso, q);
        if (isWater(iso, i)) return `trail ${id} runs through water at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`;
        if (iso.rivers.some((r) => r.points.some((rp, j) => j > 0 && distToSegment(q, r.points[j - 1]!, rp) < r.width / 2))) return `trail ${id} runs through a river at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`;
        if (k > 0 && iso.towns.owner[i]) return `trail ${id} crosses a built cell at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`;
        if (fieldDistance(iso.airport, q.x, q.y) <= TRAIL_FENCE_M - 1) return `trail ${id} runs on the airfield at (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`;
        if (k > 0) {
          const p = t.points[k - 1]!;
          const len = Math.hypot(q.x - p.x, q.y - p.y);
          const g = len > 0 ? Math.abs(sample(iso.height, q.x, q.y) - sample(iso.height, p.x, p.y)) / len : 0;
          if (g > worst) {
            worst = g;
            worstAt = q;
          }
        }
      }
      if (worst > spec.maxGrade * 1.02) return `trail ${id} is ${worst.toFixed(2)} steep at (${worstAt.x.toFixed(0)}, ${worstAt.y.toFixed(0)}); max_grade is ${spec.maxGrade}`;
      let length = 0;
      for (let k = 1; k < t.points.length; k++) length += Math.hypot(t.points[k]!.x - t.points[k - 1]!.x, t.points[k]!.y - t.points[k - 1]!.y);
      if (length < spec.minLength || length > spec.maxLength) return `trail ${id} is ${length.toFixed(0)} m long; the spec asks for ${spec.minLength}-${spec.maxLength} m`;
    }
    return undefined;
  },
  'pinned-places-on-land': ({ iso }) => {
    if (!iso.act1.anchorDry) return 'the Act 1 anchor is not on dry land';
    // A bridge sits on the canal by design: bridge-landmarks-on-crossing holds it instead.
    for (const l of iso.landmarks) if (l.rule.kind !== 'crossing' && isWater(iso, cellOf(iso, l.at))) return `landmark ${l.id} is on water`;
    return undefined;
  },
  'wilderness-between-centres': ({ metrics }) => (metrics.wildernessShare >= 0.6 ? undefined : `wilderness is ${(metrics.wildernessShare * 100).toFixed(0)}% of land; it must stay ≥ 60%`),
};

export function runGuards(iso: Isthmus, config: ProceduralSpec, metrics: Metrics = metricsOf(iso, config)): Violation[] {
  const out: Violation[] = [];
  for (const [guard, fn] of Object.entries(GUARDS)) {
    const message = fn({ iso, config, metrics });
    if (message) out.push({ guard, message });
  }
  return out;
}
