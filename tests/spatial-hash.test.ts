import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpatialHash } from '../src/sim/spatial-hash.ts';
import { createRng } from '../src/world/rng.ts';

test('query returns exactly the points within radius', () => {
  const h = createSpatialHash(5);
  const rng = createRng(1);
  const pts = Array.from({ length: 300 }, (_, i) => ({ id: i, p: { x: rng.range(-50, 50), y: rng.range(-50, 50) } }));
  for (const q of pts) h.insert(q.id, q.p);
  const c = { x: 3, y: -7 };
  const got = h.query(c, 12).sort((a, b) => a - b);
  const want = pts.filter((q) => Math.hypot(q.p.x - c.x, q.p.y - c.y) <= 12).map((q) => q.id);
  assert.deepEqual(got, want);
  assert.ok(want.length > 0);
});

test('clear empties the hash; negative coordinates work', () => {
  const h = createSpatialHash(2);
  h.insert(1, { x: -0.5, y: -0.5 });
  assert.deepEqual(h.query({ x: 0, y: 0 }, 1), [1]);
  h.clear();
  assert.deepEqual(h.query({ x: 0, y: 0 }, 1), []);
});
