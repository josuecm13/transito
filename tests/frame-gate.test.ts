import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFrameGate } from '../src/sim/frame-gate.ts';

const S = 1 / 60;
const gate = () => createFrameGate({ step: S, maxSteps: 5, maxDt: 0.1, startMs: 0 });

test('running frames advance fixed steps', () => {
  const g = gate();
  assert.equal(g.advance(1000 / 30, false).steps, 2);
});

test('no steps while paused', () => {
  const g = gate();
  g.advance(16, false);
  assert.equal(g.advance(32, true).steps, 0);
});

test('after a long pause the first frames run at most 1 fixed step (no catch-up)', () => {
  const g = gate();
  g.advance(S * 1000 * 0.9, false); // leave 0.9 of a step in the accumulator
  let t = S * 1000 * 0.9;
  for (let i = 0; i < 10; i++) {
    t += 500;
    assert.equal(g.advance(t, true).steps, 0);
  }
  t += 60_000; // one minute later, unpaused
  const first = g.advance(t, false);
  assert.ok(first.steps <= 1, `first frame ran ${first.steps} steps`);
  assert.equal(first.dt, 0);
  // stale accumulator would turn this 0.2-step frame into a step
  t += S * 1000 * 0.2;
  assert.equal(g.advance(t, false).steps, 0);
});
