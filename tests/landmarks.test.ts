// Card 2 (docs/map-reshape/03-technical/12-sectors-and-streaming.md 6): the arch bridge follows the generated
// road/canal crossing instead of sitting at the authored canal mouth. Measured on the generated isthmus with the
// saved Map Studio edits (the map the game uses).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { GUARDS } from '../src/studio/guards.ts';
import { parseEdits, parseWorldWithEdits, serialiseEdits } from '../src/studio/saved.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { routeCrossing } from '../src/world/proc/landmarks.ts';
import type { WorldSpec } from '../src/world/spec.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const yaml = read('specs/map/world.yaml');
const saved = read('specs/map/procedural-edits.json');
const spec: WorldSpec = parseWorldWithEdits(yaml, saved);
let iso: Isthmus;
let moved: Isthmus;

/** Harmless dry patch: the road's first stop (balboa) moves 200 m north, so the road and its canal crossing shift. */
const patched = (): WorldSpec => {
  const base = parseEdits(saved);
  const stop = spec.procedural.roads.stops.balboa!;
  return parseWorldWithEdits(yaml, serialiseEdits([...base, { path: 'procedural.roads.stops.balboa', value: [stop.x, stop.y + 200] }]));
};

before(() => {
  iso = generateIsthmus(spec);
  moved = generateIsthmus(patched());
});

const rule = (s: WorldSpec) => {
  const r = s.procedural.landmarks.find((l) => l.id === 'arch-bridge')!.rule;
  assert.equal(r.kind, 'crossing');
  return r as Extract<typeof r, { kind: 'crossing' }>;
};
const crossingOf = (i: Isthmus, s: WorldSpec) => {
  const x = routeCrossing(i.roads.paths.find((p) => p.id === rule(s).route)!.points, i.canal.centreline);
  assert.ok(x?.crosses, 'the route crosses the canal');
  return x;
};
const at = (i: Isthmus, id: string) => i.landmarks.find((l) => l.id === id)!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

test('arch-bridge sits within the spec tolerance of the generated crossing, heading along the road', () => {
  const x = crossingOf(iso, spec);
  const lm = at(iso, 'arch-bridge');
  const d = dist(lm.at, x.at);
  console.log(`arch-bridge (${lm.at.x.toFixed(1)}, ${lm.at.y.toFixed(1)}) heading ${lm.heading?.toFixed(1)}; crossing (${x.at.x.toFixed(1)}, ${x.at.y.toFixed(1)}); ${d.toFixed(2)} m; authored (1300, 400)`);
  assert.ok(d <= rule(spec).tolerance, `${d} m from the crossing`);
  assert.ok(dist(lm.at, { x: 1300, y: 400 }) > 300, 'no longer at the authored canal mouth');
  assert.ok(Math.abs(x.at.x - 1190) < 60 && Math.abs(x.at.y - 1060) < 60, 'the generated crossing is near (1190, 1060)');
  assert.ok(lm.heading! >= 0 && lm.heading! < 180);
  assert.equal(GUARDS['bridge-landmarks-on-crossing']!({ iso, config: spec.procedural, metrics: undefined as never }), undefined);
});

test('the landmark follows the crossing when a Studio edit moves the road', () => {
  const s2 = patched();
  const x0 = crossingOf(iso, spec).at;
  const x1 = crossingOf(moved, s2).at;
  const a = at(iso, 'arch-bridge').at;
  const b = at(moved, 'arch-bridge').at;
  console.log(`crossing (${x0.x.toFixed(0)}, ${x0.y.toFixed(0)}) -> (${x1.x.toFixed(0)}, ${x1.y.toFixed(0)}); arch-bridge (${a.x.toFixed(0)}, ${a.y.toFixed(0)}) -> (${b.x.toFixed(0)}, ${b.y.toFixed(0)})`);
  assert.ok(dist(x0, x1) > 5, 'the patch moved the crossing');
  assert.ok(dist(a, b) > 5, 'the landmark moved with it');
  assert.ok(dist(b, x1) <= rule(s2).tolerance, 'and still sits on the new crossing');
});

test('Act 1 and airport landmarks have not moved (saved-edits map, before = measured before the rule existed)', () => {
  const before = {
    'tito-home': [4310, 1250],
    'corridor-market': [4430, 1350],
    'miguelito-hills': [4310, 1630],
    'passenger-terminal': [4753.102, 2904.885],
    'cargo-terminal': [4895.899, 2879.706],
  } as const;
  for (const [id, [x, y]] of Object.entries(before)) {
    const l = at(iso, id).at;
    assert.ok(Math.abs(l.x - x!) < 0.01 && Math.abs(l.y - y!) < 0.01, `${id} (${l.x}, ${l.y}) vs (${x}, ${y})`);
  }
  assert.equal(iso.landmarks.length, 6);
});

test('guard bridge-landmarks-on-crossing fires on a bridge pinned back to the authored coordinates', () => {
  const lms = iso.landmarks.map((l) => (l.id === 'arch-bridge' ? { ...l, at: { x: 1300, y: 400 } } : l));
  const msg = GUARDS['bridge-landmarks-on-crossing']!({ iso: { ...iso, landmarks: lms }, config: spec.procedural, metrics: undefined as never });
  assert.match(msg ?? '', /arch-bridge is \d+ m from where interamericana crosses the canal/);
});

test('guard fires when the route no longer crosses the canal', () => {
  const paths = iso.roads.paths.map((p) => (p.id === 'interamericana' ? { ...p, points: p.points.map((q) => ({ x: q.x + 5000, y: q.y })) } : p));
  const msg = GUARDS['bridge-landmarks-on-crossing']!({ iso: { ...iso, roads: { ...iso.roads, paths } }, config: spec.procedural, metrics: undefined as never });
  assert.match(msg ?? '', /does not cross the canal/);
});
