import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneToSpec, specAngleToSceneYaw, specToScene } from '../src/world/coords.ts';

test('north in spec is -z in scene, east is +x, height is y', () => {
  const o = specToScene({ x: 0, y: 0 });
  const n = specToScene({ x: 0, y: 10 });
  const e = specToScene({ x: 10, y: 0 });
  assert.ok(n.z < o.z, 'north must decrease z');
  assert.equal(n.z, -10);
  assert.ok(e.x > o.x);
  assert.equal(specToScene({ x: 1, y: 2 }, 5).y, 5);
});

test('round trip', () => {
  const p = { x: 123.5, y: -42 };
  assert.deepEqual(sceneToSpec(specToScene(p, 7)), p);
});

test('yaw sign: CCW spec rotation turns +X (east) toward north (-z) via rotation about +Y', () => {
  const yaw = specAngleToSceneYaw(Math.PI / 2);
  // Three.js rotation about +Y by yaw applied to (1,0,0): (cos yaw, 0, -sin yaw)
  const rotated = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  // spec: east rotated CCW by 90 degrees is north, i.e. (0,1) -> scene (0, -1)
  assert.ok(Math.abs(rotated.x) < 1e-9);
  assert.ok(Math.abs(rotated.z - -1) < 1e-9);
});
