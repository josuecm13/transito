import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPauseState } from '../src/ecs/pause.ts';

test('starts running', () => {
  const p = createPauseState();
  assert.equal(p.paused, false);
  assert.deepEqual(p.reasons(), []);
});

test('paused while at least one reason is held', () => {
  const p = createPauseState();
  p.pause('screens');
  p.pause('focus');
  p.resume('screens');
  assert.equal(p.paused, true);
  assert.deepEqual(p.reasons(), ['focus']);
  p.resume('focus');
  assert.equal(p.paused, false);
});

test('pause and resume are idempotent per reason', () => {
  const p = createPauseState();
  p.pause('a');
  p.pause('a');
  assert.deepEqual(p.reasons(), ['a']);
  p.resume('a');
  assert.equal(p.paused, false);
  p.resume('a');
  assert.equal(p.paused, false);
});
