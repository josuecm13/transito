import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import { rectContains } from '../src/world/geometry.ts';

const spec = parseWorldSpec(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
const slice = sliceWorld(spec);
const pos = (id: string) => spec.landmarks.find((l) => l.id === id)!.position;

test('slice contains the act 1 landmarks and excludes far ones', () => {
  const ids = slice.landmarks.map((l) => l.id);
  for (const id of ['tito-home', 'corridor-market', 'miguelito-hills']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('container-port'));
});

test('every street point is inside the rect', () => {
  assert.ok(slice.streets.length > 0);
  for (const s of slice.streets) for (const p of s.centerline) assert.ok(rectContains(slice.rect, p), `${s.routeId} ${p.x},${p.y}`);
});

test('corridor-avenue present with the arterial profile width', () => {
  const s = slice.streets.filter((x) => x.routeId === 'corridor-avenue');
  assert.ok(s.length >= 1);
  assert.equal(s[0]!.width, spec.streetProfiles['arterial']!.width);
  assert.equal(s[0]!.sidewalk, spec.streetProfiles['arterial']!.sidewalk);
  assert.ok(slice.streets.some((x) => x.kind === 'runway' && x.width === 45));
});

test('playable land: landmarks yes, sea no', () => {
  assert.equal(slice.isPlayableLand(pos('tito-home')), true);
  assert.equal(slice.isPlayableLand(pos('corridor-market')), true);
  assert.equal(slice.isPlayableLand({ x: 4300, y: 100 }), false);
  assert.equal(slice.isPlayableLand({ x: slice.rect.minX - 1, y: 2000 }), false);
});

test('walls include the four rect edges and lie within the rect', () => {
  assert.ok(slice.walls.length >= 4);
  for (const [a, b] of slice.walls) {
    assert.ok(rectContains(slice.rect, a) && rectContains(slice.rect, b));
  }
});
