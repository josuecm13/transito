import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraPose, damp } from '../src/sim/camera-rig.ts';

const T = { x: 10, y: 0, z: -20 };

test('pitch 55 deg: camera-to-target vector is 55 deg above the ground plane', () => {
  const { position, lookAt } = cameraPose(T, 55, 45, 0);
  const dx = lookAt.x - position.x;
  const dy = lookAt.y - position.y;
  const dz = lookAt.z - position.z;
  const angle = (Math.atan2(-dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  assert.ok(Math.abs(angle - 55) < 0.01, `angle ${angle}`);
  assert.ok(Math.abs(Math.hypot(dx, dy, dz) - 45) < 1e-9);
});

test('yaw 0 is north-up: camera is south (greater z) of the target', () => {
  const { position } = cameraPose(T, 55, 45, 0);
  assert.ok(position.z > T.z);
  assert.ok(Math.abs(position.x - T.x) < 1e-9);
});

test('yaw 90 puts the camera east of the target', () => {
  const { position } = cameraPose(T, 55, 45, 90);
  assert.ok(position.x > T.x);
  assert.ok(Math.abs(position.z - T.z) < 1e-9);
});

test('damp is frame-rate independent', () => {
  const once = damp(0, 10, 0.12, 0.05);
  const twice = damp(damp(0, 10, 0.12, 0.025), 10, 0.12, 0.025);
  assert.ok(Math.abs(once - twice) < 1e-9);
});

test('damp: after halfLife seconds the gap halves', () => {
  assert.ok(Math.abs(damp(0, 10, 0.12, 0.12) - 5) < 1e-12);
  assert.equal(damp(3, 9, 0.12, 0), 3);
});
