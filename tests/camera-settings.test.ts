import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMERA_CYCLE,
  DEFAULT_SETTINGS,
  SENSITIVITY_STEPS,
  SETTINGS_KEY,
  nextCameraMode,
  parseSettings,
  serializeSettings,
} from '../src/sim/camera-settings.ts';

test('default camera is Cenital', () => {
  assert.equal(DEFAULT_SETTINGS.cameraMode, 'topdown');
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
});

test('serialize then parse round-trips every field', () => {
  const s = { cameraMode: 'far' as const, sensitivity: 4, invertY: true };
  assert.deepEqual(parseSettings(serializeSettings(s)), s);
});

test('garbage gives defaults', () => {
  for (const raw of ['', 'not json', '{', 'null', '42', '"x"', '[]', '{}', '{"v":999,"cameraMode":"far"}', '{"cameraMode":"far"}']) {
    assert.deepEqual(parseSettings(raw), DEFAULT_SETTINGS, raw);
  }
});

test('bad fields fall back one by one, good ones are kept', () => {
  const p = parseSettings('{"v":1,"cameraMode":"fisheye","sensitivity":99,"invertY":true}');
  assert.equal(p.cameraMode, 'topdown');
  assert.equal(p.sensitivity, DEFAULT_SETTINGS.sensitivity);
  assert.equal(p.invertY, true);
  assert.equal(parseSettings('{"v":1,"sensitivity":1.5}').sensitivity, DEFAULT_SETTINGS.sensitivity);
  assert.equal(parseSettings('{"v":1,"invertY":"yes"}').invertY, false);
});

test('stored key is versioned', () => {
  assert.match(SETTINGS_KEY, /v\d+$/);
  assert.ok(SENSITIVITY_STEPS.length >= 3);
});

test('V cycles Cenital -> 3D cerca -> 3D lejos -> Cenital', () => {
  assert.equal(nextCameraMode('topdown'), 'near');
  assert.equal(nextCameraMode('near'), 'far');
  assert.equal(nextCameraMode('far'), 'topdown');
  assert.deepEqual([...CAMERA_CYCLE], ['topdown', 'near', 'far']);
});
