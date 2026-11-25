// Card 7 (#13): evaluated maps are memoised per (resolved configuration, cell), so an edit's before/after and
// its preview cost one generation each, not three. The memo must never serve a map for another cell or another edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, openBase, type State } from '../src/studio/protocol.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = openBase(readFileSync(join(ROOT, 'specs/map/world.yaml'), 'utf8'));
const s: State = { base, saved: [], working: [] };
const EDIT = [{ path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 1.7 }];

test('the same (edits, cell) is served from the memo, any other is generated', () => {
  const a = evaluate(s, [], 80);
  assert.ok(a.ev, a.errors.join('; '));
  assert.equal(evaluate(s, [], 80).ev, a.ev, 'same edits and cell: same evaluated object');
  const otherCell = evaluate(s, [], 60);
  assert.ok(otherCell.ev, otherCell.errors.join('; '));
  assert.notEqual(otherCell.ev, a.ev, 'another cell must not reuse the 80 m map');
  assert.notEqual(otherCell.ev!.hashes.all, a.ev.hashes.all, 'hashes are per cell');
  const edited = evaluate(s, EDIT, 80);
  assert.ok(edited.ev, edited.errors.join('; '));
  assert.notEqual(edited.ev, a.ev, 'another edit must not reuse the unedited map');
  assert.notEqual(edited.ev!.hashes.towns, a.ev.hashes.towns);
});

test('the memo is bounded: the oldest entries are regenerated, results stay equal', () => {
  const first = evaluate(s, [], 80).ev!;
  for (const c of [60, 56, 50]) assert.ok(evaluate(s, [], c).ev);
  const again = evaluate(s, [], 80).ev!;
  assert.notEqual(again, first, 'evicted: generated again');
  assert.equal(again.hashes.all, first.hashes.all, 'deterministic: same hashes');
});
