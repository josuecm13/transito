// Map Studio core (#13): config API, paths, ranges, the protocol round trip and the refusal rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import { parseWorldSpec } from '../src/world/spec.ts';
import { hashesOf } from '../src/studio/metrics.ts';
import { getAt, setAt, type Json } from '../src/studio/paths.ts';
import { PARAM_DOCS, listParams, rangeProblems } from '../src/studio/params.ts';
import { handle, openBase, type Request, type State } from '../src/studio/protocol.ts';
import { parseEdits, parseWorldWithEdits, serialiseEdits } from '../src/studio/saved.ts';

const yaml = readFileSync(new URL('../specs/map/world.yaml', import.meta.url), 'utf8');
const base = openBase(yaml);
const state = (over: Partial<State> = {}): State => ({ base, saved: [], working: [], ...over });
const C = 40; // the studio's coarse cell; 60 m gives a different (and conflicting) bay crossing for the same edit

test('config API: the default config reproduces the default map; a changed config changes it', () => {
  const spec = parseWorldSpec(yaml);
  const a = hashesOf(generateIsthmus(spec, { cell: C }));
  const b = hashesOf(generateIsthmus(spec, { cell: C, config: spec.procedural }));
  assert.deepEqual(a, b);
  const other = { ...spec.procedural, lake: { ...spec.procedural.lake, targetKm2: 3 } };
  assert.notEqual(hashesOf(generateIsthmus(spec, { cell: C, config: other })).all, a.all, 'the config is ignored');
});

test('paths: by key, index and id; unknown parameters are refused', () => {
  const doc = base.proc;
  assert.equal(getAt(doc, 'lake.target_km2'), 5);
  assert.equal(getAt(doc, 'towns.items[id=la-ciudad].target_km2'), 1.8);
  assert.equal(getAt(doc, 'roads.stops.city-north'), getAt(doc, 'roads.stops.city-north'));
  const copy = JSON.parse(JSON.stringify(doc)) as Json;
  setAt(copy, 'towns.items[id=colon].target_km2', 0.7);
  assert.equal(getAt(copy, 'towns.items[id=colon].target_km2'), 0.7);
  assert.throws(() => setAt(copy, 'lake.nope', 1), /no such parameter/);
  assert.throws(() => setAt(copy, 'towns.items[id=zzz].target_km2', 1), /no entry with id/);
  assert.throws(() => getAt(copy, 'lake..x'), /bad path/);
});

test('params: every documented parameter exists in the config and its default is inside its range', () => {
  const entries = listParams(base.proc);
  const norm = (p: string): string => p.replace(/\[\d+\]|\[id=[^\]]+\]/g, '[*]');
  const have = new Set(entries.map((e) => norm(e.path)));
  // District items exist only once a preset is added (tests/studio-districts.test.ts checks those docs resolve then).
  for (const key of Object.keys(PARAM_DOCS).filter((k) => !k.startsWith('procedural.districts.items[*]'))) assert.ok(have.has(key), `PARAM_DOCS names '${key}' which the config does not have`);
  for (const e of entries) if (e.doc) assert.deepEqual(rangeProblems(e.path, e.default), [], e.path);
  assert.ok(rangeProblems('procedural.lake.target_km2', 99).length, 'range guard is silent');
});

test('describe / inspect: machine-readable, revision stable across calls', () => {
  const d = handle(state(), { op: 'describe' });
  assert.ok(d.response.ok);
  const data = d.response.data as { parameters: unknown[]; jsonSchema: { properties: object } };
  assert.ok(data.parameters.length > 100);
  assert.ok('lake' in data.jsonSchema.properties);
  assert.equal(handle(state(), { op: 'inspect' }).response.revision, d.response.revision);
});

test('patch: dryRun changes nothing; apply changes the revision; the same patch twice gives the same hashes', () => {
  const req: Request = { op: 'patch', cell: C, dryRun: true, changes: [{ path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 2.4 }] };
  const s = state();
  const a = handle(s, req);
  assert.ok(a.response.ok, a.response.errors.join('; '));
  assert.equal(a.working, undefined, 'dryRun produced new state');
  assert.equal(a.response.revision, handle(s, { op: 'inspect' }).response.revision);
  const b = handle(s, req);
  assert.deepEqual(a.response.hashes, b.response.hashes);
  const applied = handle(s, { ...req, dryRun: false });
  assert.ok(applied.working && applied.working.length === 1);
  assert.notEqual(applied.response.revision, a.response.revision);
  assert.equal(applied.response.revision, (a.response.data as { wouldBecomeRevision: string }).wouldBecomeRevision);
  assert.ok(applied.response.changed!.some((c) => c.path.endsWith('target_km2') && c.after === 2.4));
});

test('patch refusals: range, unknown path, stale revision, hard anchor, outside the map', () => {
  const s = state();
  assert.match(handle(s, { op: 'patch', changes: [{ path: 'procedural.lake.target_km2', value: 99 }] }).response.errors[0]!, /above the maximum/);
  assert.match(handle(s, { op: 'patch', changes: [{ path: 'procedural.lake.nope', value: 1 }] }).response.errors[0]!, /no such parameter/);
  assert.match(handle(s, { op: 'patch', expectedRevision: 'stale', changes: [] }).response.errors[0]!, /revision mismatch/);
  assert.match(handle(s, { op: 'move-anchor', anchor: 'canal:pacific', to: [1300, 300] }).response.errors[0]!, /hard anchor/);
  assert.match(handle(s, { op: 'move-anchor', anchor: 'stop:roads:city', to: [-5, 10] }).response.errors[0]!, /outside the map/);
  assert.match(handle(s, { op: 'patch', changes: [{ path: 'procedural.roads.routes[id=railroad].stops', value: ['balboa', 'nowhere'] }] }).response.errors.join(), /unknown stop/);
});

test('a guard-breaking edit is refused as a conflict and the last valid state is kept', () => {
  const s = state();
  const lakeFlood = handle(s, { op: 'patch', cell: C, changes: [{ path: 'procedural.lake.target_km2', value: 7 }] });
  assert.equal(lakeFlood.response.ok, false);
  assert.match(lakeFlood.response.errors[0]!, /conflict — .*last valid state is kept/);
  assert.equal(lakeFlood.working, undefined);
  assert.equal(lakeFlood.response.revision, handle(s, { op: 'inspect' }).response.revision);
});

test('round trip: describe → inspect → dryRun patch → validate → save → preview is reproducible', () => {
  let s = state();
  const step = (req: Request) => {
    const o = handle(s, req);
    if (o.working) s = { ...s, working: o.working };
    if (o.saved) s = { ...s, saved: o.saved };
    return o;
  };
  const run = () => {
    s = state();
    step({ op: 'describe' });
    step({ op: 'inspect' });
    const dry = step({ op: 'patch', dryRun: true, cell: C, changes: [{ path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 2.0 }] });
    assert.ok(dry.response.ok);
    step({ op: 'patch', cell: C, changes: [{ path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 2.0 }] });
    const v = step({ op: 'validate', cell: C });
    assert.ok(v.response.ok, v.response.errors.join('; '));
    const saved = step({ op: 'save', cell: C });
    assert.ok(saved.response.ok);
    const p = step({ op: 'preview', cell: C, metresPerPixel: 40 });
    return { edits: serialiseEdits(s.saved), hashes: p.response.hashes, pixels: (p.response.data as { pixelHash: string }).pixelHash, revision: p.response.revision };
  };
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  // The saved file loads back into the same map.
  const spec = parseWorldWithEdits(yaml, a.edits);
  assert.equal(spec.procedural.towns.items.find((t) => t.id === 'la-ciudad')!.targetKm2, 2.0);
  assert.deepEqual(parseEdits(a.edits), s.saved);
});
