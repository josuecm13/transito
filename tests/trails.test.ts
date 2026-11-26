// Card 3 (docs/map-reshape/03-technical/12-sectors-and-streaming.md 6, 8.3): one hiking trail from the landside of the
// airport terminal to a ridge viewpoint, spec + generated route only. Measured on the saved-edits map (the one the game
// uses) and on the unedited map.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { GUARDS } from '../src/studio/guards.ts';
import { hashesOf } from '../src/studio/metrics.ts';
import { parseEdits, parseWorldWithEdits, serialiseEdits } from '../src/studio/saved.ts';
import { gameSpecFromIsthmus } from '../src/world/proc/game-spec.ts';
import { sample } from '../src/world/proc/grid.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { parseWorldSpec, type WorldSpec } from '../src/world/spec.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const yaml = read('specs/map/world.yaml');
const saved = read('specs/map/procedural-edits.json');

interface Case {
  name: string;
  spec: WorldSpec;
  iso: Isthmus;
  /** Hashes of the same map generated before `procedural.trails` existed (fp 2026-11-25, tools/fp: hashesOf). */
  before: Record<string, string>;
}
let cases: Case[];

before(() => {
  const maps: [string, WorldSpec, Record<string, string>][] = [
    ['saved edits', parseWorldWithEdits(yaml, saved), { height: '1ae09ee6aea390', lake: '162b4e4a290d4b', rivers: '02b4cbde84c571', roads: '0e6a6397b64edc', towns: '18b2e49d569342', transit: '05e1d92ecca21b', districts: '070abb841895c1', all: '1d141e204be6bd' }],
    ['unedited', parseWorldSpec(yaml), { height: '1080e9a409508f', lake: '162b4e4a290d4b', rivers: '1fc8f4b309d2f9', roads: '12ee969baa4bbf', towns: '16d4aa7b806f46', transit: '1a6f8ae4c8a796', districts: '070abb841895c1', all: '0d63a1bd02030d' }],
  ];
  cases = maps.map(([name, spec, b]) => ({ name, spec, iso: generateIsthmus(spec), before: b }));
});

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const gradeOf = (iso: Isthmus, pts: readonly { x: number; y: number }[]): number[] =>
  pts.slice(1).map((q, k) => Math.abs(sample(iso.height, q.x, q.y) - sample(iso.height, pts[k]!.x, pts[k]!.y)) / dist(q, pts[k]!));

test('(a) the trail exists, starts at the terminal landside and ends at the viewpoint', () => {
  for (const c of cases) {
    const t = c.iso.trails.find((x) => x.id === 'airport-ridge')!;
    assert.ok(t?.found, `${c.name}: routed`);
    const first = t.points[0]!;
    const last = t.points[t.points.length - 1]!;
    assert.ok(dist(first, c.iso.airport.terminal) <= 2 * c.iso.height.cell, `${c.name}: starts ${dist(first, c.iso.airport.terminal)} m from the terminal`);
    assert.ok(dist(last, t.viewpoint) <= c.iso.height.cell, `${c.name}: ends at the viewpoint`);
    assert.ok(dist(t.viewpoint, c.iso.airport.terminal) >= c.spec.procedural.trails[0]!.viewpoint.minDistance, `${c.name}: viewpoint is not the terminal`);
    assert.ok(sample(c.iso.height, last.x, last.y) > sample(c.iso.height, first.x, first.y) + 20, `${c.name}: the viewpoint is higher than the start`);
    console.log(`${c.name}: start (${first.x}, ${first.y}) end (${last.x}, ${last.y}) ${t.length.toFixed(0)} m, ${t.points.length} points`);
  }
});

test('(b) no edge of the trail is steeper than max_grade; percentiles are printed', () => {
  for (const c of cases) {
    const t = c.iso.trails[0]!;
    const g = gradeOf(c.iso, t.points).sort((a, b) => a - b);
    const q = (f: number) => g[Math.floor(f * (g.length - 1))]!;
    console.log(`${c.name}: grade p50 ${q(0.5).toFixed(3)} p90 ${q(0.9).toFixed(3)} p99 ${q(0.99).toFixed(3)} max ${q(1).toFixed(3)} (limit ${t.maxGrade})`);
    assert.ok(q(1) <= t.maxGrade * 1.02, `${c.name}: max grade ${q(1)}`);
  }
});

test('(c) length is within [min_length, max_length] and every point is inside the Act 1 rect', () => {
  for (const c of cases) {
    const t = c.iso.trails[0]!;
    const rect = gameSpecFromIsthmus(c.spec, c.iso).spec.activeArea;
    const len = t.points.slice(1).reduce((s, q, k) => s + dist(q, t.points[k]!), 0);
    assert.ok(len >= t.minLength && len <= t.maxLength, `${c.name}: ${len} m`);
    for (const q of t.points) assert.ok(q.x >= rect.x[0] && q.x <= rect.x[1] && q.y >= rect.y[0] && q.y <= rect.y[1], `${c.name}: (${q.x}, ${q.y}) outside ${rect.x} x ${rect.y}`);
    console.log(`${c.name}: rect x ${rect.x} y ${rect.y}, length ${len.toFixed(0)} m`);
  }
});

test('(d) every other hash is identical with the trail present and `all` is identical without it', () => {
  for (const c of cases) {
    const withTrail = hashesOf(c.iso);
    assert.notEqual(withTrail.trails, '', 'the trail has its own hash');
    assert.notEqual(withTrail.all, c.before.all!, 'the trail joins `all` when present');
    for (const k of ['height', 'lake', 'rivers', 'roads', 'towns', 'transit', 'districts']) assert.equal((withTrail as unknown as Record<string, string>)[k], c.before[k], `${c.name}: ${k}`);
    const without = hashesOf(generateIsthmus(c.spec, { config: { ...c.spec.procedural, trails: [] } }));
    assert.equal(without.trails, '');
    assert.equal(without.all, c.before.all, `${c.name}: all`);
    for (const k of ['height', 'lake', 'rivers', 'roads', 'towns', 'transit', 'districts']) assert.equal((without as unknown as Record<string, string>)[k], c.before[k], `${c.name} without: ${k}`);
  }
});

test('guard trail-connected-and-grade passes on both maps and fires on forged and over-steep trails', () => {
  const guard = GUARDS['trail-connected-and-grade']!;
  for (const c of cases) assert.equal(guard({ iso: c.iso, config: c.spec.procedural, metrics: undefined as never }), undefined, c.name);
  const c = cases[0]!;
  const t = c.iso.trails[0]!;
  const run = (trail: typeof t, config = c.spec.procedural) => guard({ iso: { ...c.iso, trails: [trail] }, config, metrics: undefined as never });
  assert.match(run({ ...t, points: [t.points[0]!, { x: t.points[0]!.x, y: t.points[0]!.y + 3000 }, ...t.points.slice(1)] }) ?? '', /leaves the Act 1 rect/);
  assert.match(run({ ...t, points: t.points.slice(5) }) ?? '', /starts .* from the airport terminal/);
  assert.match(run({ ...t, points: [] , found: false }) ?? '', /no route/);
  const lower = { ...c.spec.procedural, trails: [{ ...c.spec.procedural.trails[0]!, maxGrade: 0.02 }] };
  assert.match(run(t, lower) ?? '', /steep/);
  const shortMax = { ...c.spec.procedural, trails: [{ ...c.spec.procedural.trails[0]!, maxLength: 500, minLength: 100 }] };
  assert.match(run(t, shortMax) ?? '', /long/);
});

test('MUTATION: max_grade 0.05 leaves no route, so the guard is red (generation does not throw)', () => {
  const edits = [...parseEdits(saved), { path: 'procedural.trails[id=airport-ridge].max_grade', value: 0.05 }];
  const spec = parseWorldWithEdits(yaml, serialiseEdits(edits));
  assert.equal(spec.procedural.trails[0]!.maxGrade, 0.05);
  const iso = generateIsthmus(spec);
  assert.equal(iso.trails[0]!.found, false, 'no route at 5 %');
  const msg = GUARDS['trail-connected-and-grade']!({ iso, config: spec.procedural, metrics: undefined as never });
  assert.match(msg ?? '', /no route/);
});
