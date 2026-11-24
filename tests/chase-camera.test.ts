import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PITCH_LIMITS,
  chasePose,
  chasePreset,
  footRecenterTarget,
  lookBehindYaw,
  occludedDistance,
  orbitStep,
  recenterYaw,
  smoothDistance,
} from '../src/sim/chase-camera.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const rad = (d: number) => (d * Math.PI) / 180;
const F = { x: 100, y: 2, z: -50 };

test('3D pose: yaw 0 sits south of the focus, behind a north-facing body, low and at distance', () => {
  const p = chasePose(F, 0, 16, 6);
  near(p.position.x, F.x);
  assert.ok(p.position.z > F.z);
  near(Math.hypot(p.position.x - F.x, p.position.y - F.y, p.position.z - F.z), 6);
  near(p.position.y - F.y, 6 * Math.sin(rad(16)));
  assert.deepEqual(p.lookAt, F);
});

test('3D pose: camera yaw equal to a body yaw puts the camera behind that body', () => {
  // A body with scene yaw y has its nose toward (-sin y, -cos y); the camera must be on the opposite side.
  for (const y of [0.4, 1.9, -2.5]) {
    const p = chasePose(F, y, 16, 6);
    const toCamX = p.position.x - F.x;
    const toCamZ = p.position.z - F.z;
    assert.ok(toCamX * -Math.sin(y) + toCamZ * -Math.cos(y) < 0, `yaw ${y}`);
  }
});

test('presets: ~6 m on foot and ~9 m in the car, low pitch 12-20 deg, far is farther', () => {
  const foot = chasePreset('near', false);
  const car = chasePreset('near', true);
  assert.equal(foot.distance, 6);
  assert.equal(car.distance, 9);
  assert.ok(foot.pitchDeg >= 12 && foot.pitchDeg <= 20);
  assert.ok(chasePreset('far', false).distance > foot.distance);
  assert.ok(chasePreset('far', true).distance > car.distance);
});

test('occlusion: a hit shortens the boom to just before it, clear ray keeps the distance', () => {
  assert.equal(occludedDistance(6, null, 0.4, 1.2), 6);
  near(occludedDistance(6, 3, 0.4, 1.2), 2.6);
  assert.equal(occludedDistance(6, 1.0, 0.4, 1.2), 1.2); // never closer than the minimum
  assert.equal(occludedDistance(6, 50, 0.4, 1.2), 6); // far hit never lengthens it
});

test('distance smoothing: pulls in instantly, eases back out', () => {
  assert.equal(smoothDistance(6, 2, 0.25, 0.016), 2);
  const out = smoothDistance(2, 6, 0.25, 0.016);
  assert.ok(out > 2 && out < 6);
});

test('recenter waits for the idle delay', () => {
  assert.equal(recenterYaw(1, 0, 1.4, 0.016), 1);
  assert.notEqual(recenterYaw(1, 0, 1.6, 0.016), 1);
});

test('recenter takes the short way around (350 deg to 10 deg goes up through 0)', () => {
  const from = rad(350);
  const to = rad(10);
  let yaw = from;
  const step = recenterYaw(yaw, to, 2, 0.1);
  const moved = Math.atan2(Math.sin(step - from), Math.cos(step - from)); // signed shortest delta
  assert.ok(moved > 0 && moved < rad(20), `moved ${moved}`);
  for (let i = 0; i < 200; i++) yaw = recenterYaw(yaw, to, 2, 0.1);
  near(Math.atan2(Math.sin(yaw - to), Math.cos(yaw - to)), 0, 1e-6);
  // and the opposite direction
  const back = recenterYaw(to, from, 2, 0.1);
  assert.ok(Math.atan2(Math.sin(back - to), Math.cos(back - to)) < 0);
});

test('recenter result stays wrapped', () => {
  const r = recenterYaw(rad(179), rad(-179), 2, 0.1);
  assert.ok(r <= Math.PI && r > -Math.PI);
});

test('orbit: mouse right turns the view right, up looks up, pitch is clamped, invert flips Y', () => {
  const k = 0.01;
  const right = orbitStep(0, 16, 10, 0, k, false);
  assert.ok(right.yaw < 0); // camera swings so the view turns toward east
  const up = orbitStep(0, 30, 0, -10, k, false);
  assert.ok(up.pitchDeg < 30);
  const inv = orbitStep(0, 30, 0, -10, k, true);
  assert.ok(inv.pitchDeg > 30);
  assert.equal(orbitStep(0, 30, 0, 1e6, k, false).pitchDeg, PITCH_LIMITS.maxDeg);
  assert.equal(orbitStep(0, 30, 0, -1e6, k, false).pitchDeg, PITCH_LIMITS.minDeg);
});

test('foot recenter: only while moving, and not when walking toward the camera', () => {
  assert.equal(footRecenterTarget({ x: 0, y: 0 }, 1), null);
  assert.equal(footRecenterTarget({ x: 0, y: -1 }, 1), null);
  assert.equal(footRecenterTarget({ x: 0, y: 1 }, 1), 1);
  assert.equal(footRecenterTarget({ x: 1, y: 0 }, 1), 1);
});

test('look behind is the heading turned half a circle', () => {
  near(Math.abs(lookBehindYaw(0)), Math.PI);
  near(lookBehindYaw(Math.PI / 2), -Math.PI / 2);
});
