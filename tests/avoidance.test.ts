import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlocked } from '../src/sim/avoidance.ts';

const self = { p: { x: 0, y: 0 }, heading: { x: 1, y: 0 }, radius: 0.3 };
const other = (x: number, y: number) => ({ p: { x, y }, radius: 0.3 });

test('blocked by something ahead within lookAhead', () => {
  assert.equal(isBlocked(self, [other(1, 0)], 1.4), true);
  assert.equal(isBlocked(self, [other(1.2, 0.5)], 1.4), true); // inside width 0.6
});

test('not blocked by something beyond lookAhead', () => {
  assert.equal(isBlocked(self, [other(3, 0)], 1.4), false);
});

test('not blocked by something behind', () => {
  assert.equal(isBlocked(self, [other(-1, 0)], 1.4), false);
  assert.equal(isBlocked(self, [other(-0.2, 0.1)], 1.4), false);
});

test('not blocked by something beside beyond the width', () => {
  assert.equal(isBlocked(self, [other(1, 0.8)], 1.4), false);
  assert.equal(isBlocked(self, [other(1, -0.8)], 1.4), false);
});
