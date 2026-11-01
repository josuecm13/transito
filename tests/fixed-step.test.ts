import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFixedStep } from '../src/sim/fixed-step.ts';

const S = 1 / 60;

test('1/30 s frame at 60 Hz runs 2 steps', () => {
  assert.equal(createFixedStep(S, 5).advance(1 / 30), 2);
});

test('remainder carries across frames', () => {
  const f = createFixedStep(S, 5);
  assert.equal(f.advance(S * 0.6), 0);
  assert.equal(f.advance(S * 0.6), 1);
  assert.ok(Math.abs(f.alpha - 0.2) < 1e-6);
});

test('huge dt clamps to max steps and drops excess', () => {
  const f = createFixedStep(S, 5);
  assert.equal(f.advance(10), 5);
  assert.equal(f.alpha, 0);
  assert.equal(f.advance(0), 0);
});
