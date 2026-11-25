// Map Studio protocol round trip (#13, card 3): describe → inspect → dryRun patch → patch → save → reload → same map.
// In-process through the pure handle() (no writes to specs/ or .cache/); one spawned CLI call for the stdin/stdout
// path, read-only (describe + dryRun).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, openBase, type State } from '../src/studio/protocol.ts';
import { parseEdits, serialiseEdits } from '../src/studio/saved.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = openBase(readFileSync(join(ROOT, 'specs/map/world.yaml'), 'utf8'));
const fresh = (): State => ({ base, saved: [], working: [] });
// Not lake 5.8 km² (the issue's example): it floods the gamboa stop further (210–251 m from its authored place) and the routes-connected guard refuses it.
const PATCH = { path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 1.9 };

test('describe → inspect → dryRun patch leaves the state untouched', () => {
  const s = fresh();
  const d = handle(s, { op: 'describe' });
  assert.ok(d.response.ok);
  const rev = d.response.revision;
  assert.equal(handle(s, { op: 'inspect' }).response.revision, rev);
  const dry = handle(s, { op: 'patch', dryRun: true, expectedRevision: rev, changes: [PATCH] });
  assert.ok(dry.response.ok, dry.response.errors.join('; '));
  assert.equal(dry.working, undefined, 'dryRun must not return new working edits');
  assert.equal(dry.response.revision, rev);
  assert.equal(dry.response.changed?.length, 1);
});

test('patch → save → reload from serialised edits gives the same revision and hashes', () => {
  const s = fresh();
  const p = handle(s, { op: 'patch', changes: [PATCH] });
  assert.ok(p.response.ok, p.response.errors.join('; '));
  const working = p.working!;
  const saved = handle({ ...s, working }, { op: 'save' });
  assert.ok(saved.response.ok, saved.response.errors.join('; '));
  const reloaded = parseEdits(serialiseEdits(saved.saved!));
  assert.deepEqual(reloaded, saved.saved);
  const a = handle({ ...s, saved: reloaded, working: reloaded }, { op: 'generate' });
  const b = handle({ ...s, saved: reloaded, working: reloaded }, { op: 'generate' });
  assert.equal(a.response.revision, p.response.revision);
  assert.deepEqual(a.response.hashes, b.response.hashes, 'same config → same hashes across two runs');
  const baseline = handle(fresh(), { op: 'generate' });
  assert.notDeepEqual(a.response.hashes, baseline.response.hashes, 'the edit must change the generated map');
});

test('a patch that breaks a guard (lake 5.8 km²) is refused and the state is kept', () => {
  const r = handle(fresh(), { op: 'patch', changes: [{ path: 'procedural.lake.target_km2', value: 5.8 }] });
  assert.equal(r.response.ok, false);
  assert.match(r.response.errors[0]!, /routes-connected/);
  assert.equal(r.working, undefined);
});

test('stale expectedRevision and unknown anchors are refused with actionable errors', () => {
  const s = fresh();
  const stale = handle(s, { op: 'patch', expectedRevision: 'deadbeef', changes: [PATCH] });
  assert.equal(stale.response.ok, false);
  assert.match(stale.response.errors[0]!, /revision mismatch/);
  const anchor = handle(s, { op: 'move-anchor', anchor: 'canal:pacific', to: [1, 1] });
  assert.match(anchor.response.errors[0]!, /hard anchor/);
  assert.equal(anchor.working, undefined);
});

test('CLI: stdin JSON in, stdout JSON out (describe, dryRun patch), exit 0', () => {
  const run = (req: object) =>
    spawnSync(process.execPath, ['--max-old-space-size=1536', '--experimental-strip-types', join(ROOT, 'tools/map-studio.ts')], { input: JSON.stringify(req), encoding: 'utf8', timeout: 100_000 });
  const d = run({ op: 'describe' });
  assert.equal(d.status, 0, d.stderr);
  assert.ok(d.stdout.length > 65536, 'describe is larger than the pipe buffer and must arrive whole');
  const rev = JSON.parse(d.stdout).revision as string;
  const p = run({ op: 'patch', dryRun: true, expectedRevision: rev, changes: [PATCH] });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(JSON.parse(p.stdout).data.dryRun, true);
  const bad = run({ op: 'patch', dryRun: true, expectedRevision: 'nope', changes: [PATCH] });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});
