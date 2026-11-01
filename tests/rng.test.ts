import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/world/rng.ts';

const seq = (r: { next(): number }, n = 8) => Array.from({ length: n }, () => r.next());

test('same seed gives same sequence', () => {
  assert.deepEqual(seq(createRng(7)), seq(createRng(7)));
});

test('different seeds differ', () => {
  assert.notDeepEqual(seq(createRng(7)), seq(createRng(8)));
});

test('values are in [0,1) and helpers respect bounds', () => {
  const r = createRng(3);
  for (let i = 0; i < 500; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    const n = r.int(2, 4);
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 4);
    const g = r.range(5, 6);
    assert.ok(g >= 5 && g < 6);
  }
  assert.ok(['a', 'b'].includes(r.pick(['a', 'b'])));
});

test('fork streams are deterministic, independent of draws, and differ by label', () => {
  const a = createRng(1);
  const b = createRng(1);
  b.next();
  b.next(); // draws on the parent do not change forks
  assert.deepEqual(seq(a.fork('x')), seq(b.fork('x')));
  assert.notDeepEqual(seq(a.fork('x')), seq(a.fork('y')));
  assert.notDeepEqual(seq(a.fork('x')), seq(createRng(1)));
});
