import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desiredVelocity, turnTowards, yawFacing } from '../src/sim/locomotion.ts';

const T = { walk: 4.2, run: 7.5 };
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('forward (screen-up) moves north = -z', () => {
  const v = desiredVelocity({ x: 0, y: 1 }, false, T);
  near(v.x, 0);
  near(v.z, -T.walk);
  near(v.y, 0);
});

test('right moves +x', () => {
  const v = desiredVelocity({ x: 1, y: 0 }, false, T);
  near(v.x, T.walk);
  near(v.z, 0);
});

test('diagonal speed equals walk speed, even for an unnormalized axis', () => {
  const v = desiredVelocity({ x: 1, y: 1 }, false, T);
  near(Math.hypot(v.x, v.z), T.walk);
});

test('run is faster than walk', () => {
  const w = desiredVelocity({ x: 0, y: 1 }, false, T);
  const r = desiredVelocity({ x: 0, y: 1 }, true, T);
  assert.ok(Math.hypot(r.x, r.z) > Math.hypot(w.x, w.z));
  near(Math.hypot(r.x, r.z), T.run);
});

test('zero axis gives zero velocity', () => {
  assert.deepEqual(desiredVelocity({ x: 0, y: 0 }, true, T), { x: 0, y: 0, z: 0 });
});

test('turnTowards takes the shortest arc across +-PI', () => {
  const y = turnTowards(Math.PI - 0.1, -Math.PI + 0.1, 1, 0.05);
  near(y, Math.PI - 0.05);
  const y2 = turnTowards(-Math.PI + 0.1, Math.PI - 0.1, 1, 0.05);
  near(y2, -Math.PI + 0.05);
});

test('turnTowards snaps when within the step and never overshoots', () => {
  near(turnTowards(0, 0.1, 12, 0.1), 0.1);
  near(turnTowards(0, 1, 1, 0.1), 0.1);
});

test('yawFacing: north -> 0, east -> -PI/2', () => {
  near(yawFacing(0, -1), 0);
  near(yawFacing(1, 0), -Math.PI / 2);
});
