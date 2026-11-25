import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { addGround, depthPrepass, DEPTH_PREPASS_ORDER, GROUND_ORDER } from '../src/engine/meshes.ts';

test('depthPrepass: depth-only twin sharing the geometry, drawn before every ground layer', () => {
  const ground = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  const pre = depthPrepass(ground);
  const m = pre.material as MeshBasicMaterial;
  assert.equal(pre.geometry, ground.geometry);
  assert.equal(m.colorWrite, false);
  assert.equal(m.depthWrite, true);
  assert.equal(m.polygonOffset, true);
  assert.ok(m.polygonOffsetFactor > 0 && m.polygonOffsetUnits > 0);
  assert.equal(pre.renderOrder, DEPTH_PREPASS_ORDER);
  for (const [name, order] of Object.entries(GROUND_ORDER)) {
    assert.ok(DEPTH_PREPASS_ORDER < order, `prepass must precede ground layer ${name}`);
  }
});

test('addGround: adds the ground and its prepass', () => {
  const scene = new Object3D();
  const ground = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  ground.name = 'g';
  addGround(scene, ground);
  const pre = scene.children.find((c) => c !== ground) as Mesh | undefined;
  assert.ok(scene.children.includes(ground));
  assert.ok(pre, 'prepass missing');
  assert.equal(pre.geometry, ground.geometry);
  assert.equal((pre.material as MeshBasicMaterial).colorWrite, false);
});

test('world-view: far and near terrain ground are both added through addGround', () => {
  const src = readFileSync(new URL('../src/plugins/world-view.ts', import.meta.url), 'utf8');
  assert.match(src, /addGround\(scene, far\)/, 'far ground must be added with its depth prepass');
  assert.match(src, /addGround\(scene, ground\)/, 'near ground must be added with its depth prepass');
  assert.doesNotMatch(src, /scene\.add\(\s*(far|ground)\s*[,)]/, 'bare scene.add of a terrain ground skips the prepass');
});
