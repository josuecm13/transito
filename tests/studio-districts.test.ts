// Card 5 (#13): the coarse district model D(p) and its presets, through the same protocol the CLI/UI use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, openBase, type Request, type State } from '../src/studio/protocol.ts';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import { hashesOf } from '../src/studio/metrics.ts';
import { parseWorldSpec } from '../src/world/spec.ts';
import { PARAM_DOCS, rangeProblems, listParams } from "../src/studio/params.ts";
import { applyEdits } from '../src/studio/session.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const yaml = readFileSync(join(ROOT, 'specs/map/world.yaml'), 'utf8');
const base = openBase(yaml);
const fresh = (): State => ({ base, saved: [], working: [] });
const apply = (s: State, req: Request): State => {
  const o = handle(s, req);
  assert.ok(o.response.ok, `${req.op}: ${o.response.errors.join('; ')}`);
  return { ...s, working: o.working ?? s.working };
};
const TERRAIN = ['height', 'lake', 'rivers', 'roads', 'towns', 'transit'] as const;
const TOWERS: Request = { op: 'add-district', preset: 'paitilla-pacifica-towers', at: [3300, 1000] };

test('no items: the field is zero and the fingerprint is the same as a spec without the block', () => {
  const C = 40;
  const withBlock = generateIsthmus(parseWorldSpec(yaml), { cell: C });
  assert.equal(withBlock.districts.ids.length, 0);
  assert.ok(withBlock.districts.density.data.every((v) => v === 0));
  const stripped = yaml.replace(/  districts:\n    transit_weight(?:.*\n)(?:    .*\n)+/, '');
  assert.notEqual(stripped, yaml, 'the block must exist to be stripped');
  assert.equal(hashesOf(generateIsthmus(parseWorldSpec(stripped), { cell: C })).all, hashesOf(withBlock).all);
});

test('add-district: the field appears, terrain/towns/transit are untouched, the preset id is the district id', () => {
  const s0 = fresh();
  const before = handle(s0, { op: 'generate' }).response;
  const s1 = apply(s0, TOWERS);
  const after = handle(s1, { op: 'generate' }).response;
  for (const k of TERRAIN) assert.equal(after.hashes![k], before.hashes![k], `${k} must not change`);
  assert.notEqual(after.hashes!.districts, before.hashes!.districts);
  assert.ok(after.metrics!.districtsKm2['paitilla-pacifica-towers']! > 0, JSON.stringify(after.metrics!.districtsKm2));
  assert.ok(after.metrics!.districtDenseKm2 > 0);
  assert.equal(after.metrics!.districtsKm2['casco-historic-grid'], undefined);
});

test('causality: moving a metro station shifts district density but not towns', () => {
  const s1 = apply(fresh(), TOWERS);
  const a = handle(s1, { op: 'generate' }).response;
  const o = handle(s1, { op: 'move-anchor', anchor: 'stop:transit:casco', to: [2700, 900], dryRun: true });
  assert.ok(o.response.ok, o.response.errors.join('; '));
  assert.equal(o.response.hashes!.towns, a.hashes!.towns);
  assert.notEqual(o.response.hashes!.districts, a.hashes!.districts, 'a station move must change the district field');
});

test('refusals: unknown preset, duplicate id, missing placement, rail route, unknown route', () => {
  const s1 = apply(fresh(), TOWERS);
  assert.match(handle(fresh(), { op: 'add-district', preset: 'nope', at: [1, 1] }).response.errors[0]!, /unknown preset/);
  assert.match(handle(s1, TOWERS).response.errors[0]!, /already exists/);
  assert.match(handle(fresh(), { op: 'add-district', preset: 'casco-historic-grid' }).response.errors[0]!, /"at"/);
  assert.match(handle(fresh(), { op: 'add-district', preset: 'cinta-costera', along: 'railroad' }).response.errors.join(), /railroad/);
  assert.match(handle(fresh(), { op: 'add-district', preset: 'cinta-costera', along: 'nowhere' }).response.errors.join(), /unknown route/);
  assert.match(handle(fresh(), { op: 'remove-district', id: 'ghost' }).response.errors[0]!, /no district/);
});

test('guard districts-airport-gap: a tower district at the airfield is refused; the buffer preset fixes it (mutation-checked)', () => {
  const tower: Request = { op: 'patch', changes: [{ path: 'procedural.districts.items', value: [{ id: 'airport-towers', style: 'tower-cluster', around: 'airport', sigma: 1500, weight: 1 }] }] };
  assert.equal(handle(fresh(), { op: 'validate' }).response.violations!.some((v) => v.guard === 'districts-airport-gap'), false, 'green without districts');
  const bad = handle(fresh(), tower);
  assert.equal(bad.response.ok, false);
  assert.ok(bad.response.violations!.some((v) => v.guard === 'districts-airport-gap'), JSON.stringify(bad.response.violations));
  assert.match(bad.response.errors[0]!, /districts-airport-gap/);
  // Restore: the same district with a buffer preset pushing density away is allowed.
  const buffer = handle(apply(fresh(), { op: 'add-district', preset: 'tocumen-buffer' }), { op: 'validate' });
  assert.equal(buffer.response.violations!.some((v) => v.guard === 'districts-airport-gap'), false);
});

test('round trip: add → remove returns to the authored revision', () => {
  const s0 = fresh();
  const s2 = apply(apply(s0, TOWERS), { op: 'remove-district', id: 'paitilla-pacifica-towers' });
  assert.equal(handle(s2, { op: 'inspect' }).response.revision, handle(s0, { op: 'inspect' }).response.revision);
});

test('item docs resolve once an item exists, and their ranges are enforced', () => {
  const s1 = apply(fresh(), TOWERS);
  const proc = applyEdits(s1.base, s1.working).proc;
  const have = new Set(listParams(proc).map((e) => e.path.replace(/\[id=[^\]]+\]/g, '[*]')));
  for (const key of Object.keys(PARAM_DOCS).filter((k) => k.startsWith('procedural.districts.items[*]'))) assert.ok(have.has(key), `${key} has no entry once an item exists`);
  assert.ok(rangeProblems('procedural.districts.items[id=paitilla-pacifica-towers].weight', 2).length, 'weight 2 must be out of range');
  const bad = handle(s1, { op: 'patch', changes: [{ path: 'procedural.districts.items[id=paitilla-pacifica-towers].sigma', value: 99999 }] });
  assert.equal(bad.response.ok, false);
});

test('an edit that makes the generator throw (lake 9 km²) is a refusal with an actionable error, not a crash', () => {
  // At cell 20 (at 40 the routes-connected guard catches it first): the generator itself throws.
  const r = handle(fresh(), { op: 'patch', dryRun: true, cell: 20, changes: [{ path: 'procedural.lake.target_km2', value: 9 }] });
  assert.equal(r.response.ok, false);
  assert.match(r.response.errors[0]!, /generation failed: .*unreachable.*last valid state is kept/);
});

test('save validates at the authored cell unless a cell is passed (the preview cell is only a speed trade-off)', () => {
  const s = apply(fresh(), { op: 'patch', changes: [{ path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 1.9 }] });
  const saved = handle(s, { op: 'save' });
  assert.ok(saved.response.ok, saved.response.errors.join('; '));
  assert.equal((saved.response.data as { validatedAtCell: number }).validatedAtCell, 20, 'authored cell');
  const coarse = handle(s, { op: 'save', cell: 40 });
  assert.equal((coarse.response.data as { validatedAtCell: number }).validatedAtCell, 40, 'an explicit cell still applies');
});

test('verdicts do not depend on the cell: the unedited map is valid and lake 5.8 km² is refused at 20 m and at 40 m', () => {
  const lake: Request = { op: 'patch', dryRun: true, changes: [{ path: 'procedural.lake.target_km2', value: 5.8 }] };
  for (const cell of [20, 40]) {
    assert.equal(handle(fresh(), { op: 'validate', cell }).response.ok, true, `unedited map at ${cell} m`);
    const r = handle(fresh(), { ...lake, cell } as Request);
    assert.equal(r.response.ok, false, `lake 5.8 at ${cell} m`);
    assert.match(r.response.errors[0]!, /routes-connected/);
  }
});
