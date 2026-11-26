import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPluginScopes, createScope } from '../src/ecs/scope.ts';
import { disposeObject, ownSceneAdditions } from '../src/engine/dispose-object.ts';
import type { DisposableNode } from '../src/engine/dispose-object.ts';
import { worldPhysics } from '../src/plugins/world-physics.ts';
import { WorldDataKey } from '../src/plugins/keys.ts';
import { createServices } from '../src/ecs/services.ts';
import type { GameContext } from '../src/ecs/plugin.ts';

// (a) Scope ---------------------------------------------------------------------------------------
test('scope: disposes in reverse order, counts live items', () => {
  const s = createScope();
  const log: string[] = [];
  s.own(() => log.push('a'));
  s.own({ dispose: () => log.push('b') });
  s.own(() => log.push('c'));
  assert.equal(s.live, 3);
  s.dispose();
  assert.deepEqual(log, ['c', 'b', 'a']);
  assert.equal(s.live, 0);
});

test('scope: dispose is idempotent', () => {
  const s = createScope();
  let n = 0;
  s.own(() => n++);
  s.dispose();
  s.dispose();
  assert.equal(n, 1);
});

test('scope: keeps going when a disposer throws and reports all errors', () => {
  const s = createScope();
  const log: string[] = [];
  s.own(() => log.push('first'));
  s.own(() => { throw new Error('x'); });
  s.own(() => { throw new Error('y'); });
  s.own(() => log.push('last'));
  assert.throws(() => s.dispose(), (e: unknown) => e instanceof AggregateError && e.errors.length === 2);
  assert.deepEqual(log, ['last', 'first']);
});

test('scope: own() after dispose disposes at once; own returns the thing', () => {
  const s = createScope();
  const o = { dispose() { this.done = true; }, done: false };
  assert.equal(s.own(o), o);
  s.dispose();
  const late = { dispose() { this.done = true; }, done: false };
  s.own(late);
  assert.ok(late.done);
});

// (b) plugin scopes (what game.ts wires: one scope per plugin, reverse registration order) -----------
test('plugin scopes: a plugin that uses own() is torn down by disposeAll, in reverse plugin order', () => {
  const scopes = createPluginScopes();
  const log: string[] = [];
  for (const name of ['first', 'second']) {
    const ctx = { own: scopes.forPlugin(name).own } as Pick<GameContext, 'own'>;
    ctx.own(() => log.push(`${name}:1`));
    ctx.own(() => log.push(`${name}:2`));
  }
  scopes.forPlugin('silent'); // never calls own: no effect
  assert.equal(scopes.live, 4);
  scopes.disposeAll();
  assert.deepEqual(log, ['second:2', 'second:1', 'first:2', 'first:1']);
  assert.equal(scopes.live, 0);
  scopes.disposeAll(); // idempotent
  assert.equal(log.length, 4);
});

// (c) three.js disposal with fakes ---------------------------------------------------------------
class Counter { disposed = 0; dispose(): void { this.disposed++; } }
class FakeTexture extends Counter { isTexture = true; }
class FakeMaterial extends Counter { map: FakeTexture | null = null; }
class FakeMesh implements DisposableNode {
  parent: FakeScene | null = null;
  geometry: Counter;
  material: FakeMaterial | FakeMaterial[];
  constructor(geometry: Counter, material: FakeMaterial | FakeMaterial[]) { this.geometry = geometry; this.material = material; }
  traverse(cb: (o: DisposableNode) => void): void { cb(this); }
}
class FakeScene {
  children: FakeMesh[] = [];
  add(...o: FakeMesh[]): void { for (const m of o) { m.parent = this; this.children.push(m); } }
  remove(o: FakeMesh): void { this.children = this.children.filter((c) => c !== o); o.parent = null; }
}

test('world-view path: every geometry, material, texture and mesh added during build is disposed and removed', () => {
  const scene = new FakeScene();
  const lights = new FakeMesh(new Counter(), new FakeMaterial());
  scene.add(lights); // pre-existing (view-owned): must survive
  const sharedGeo = new Counter(); // ground + its depth prepass share a geometry
  const tex = new FakeTexture();
  const mats = [new FakeMaterial(), new FakeMaterial(), new FakeMaterial()];
  mats[0]!.map = tex;
  const geos = [sharedGeo, new Counter(), new Counter()];
  const scopeLike = createScope();
  ownSceneAdditions(scene, scopeLike.own, () => {
    scene.add(new FakeMesh(geos[0]!, mats[0]!), new FakeMesh(sharedGeo, mats[1]!));
    scene.add(new FakeMesh(geos[1]!, [mats[2]!]));
    scene.add(new FakeMesh(geos[2]!, new FakeMaterial()));
  });
  assert.equal(scene.children.length, 5);
  assert.equal(scopeLike.live, 4);
  scopeLike.dispose();
  assert.deepEqual(scene.children, [lights]);
  for (const g of geos) assert.ok(g.disposed >= 1, 'geometry disposed');
  for (const m of mats) assert.ok(m.disposed >= 1, 'material disposed');
  assert.equal(tex.disposed, 1);
  assert.equal(lights.geometry.disposed, 0);
});

test('ownSceneAdditions owns children even when build throws midway', () => {
  const scene = new FakeScene();
  const g = new Counter();
  const sc = createScope();
  assert.throws(() => ownSceneAdditions(scene, sc.own, () => { scene.add(new FakeMesh(g, new FakeMaterial())); throw new Error('boom'); }));
  sc.dispose();
  assert.equal(g.disposed, 1);
  assert.equal(scene.children.length, 0);
  disposeObject(scene, new FakeMesh(g, new FakeMaterial())); // removing a stranger is harmless
});

// (d) world-physics against real Rapier -------------------------------------------------------------
test('world-physics: after dispose the collider count is 0 (real Rapier)', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const nrows = 4, ncols = 4;
  const terrain = {
    heightfield: () => ({ nrows, ncols, heights: new Float32Array((nrows + 1) * (ncols + 1)), scale: { x: 40, y: 1, z: 40 }, center: { x: 0, z: 0 } }),
    footprintBase: () => 0,
    heightAt: () => 0,
    grid: { cell: 8 },
  };
  const buildings = [
    { center: { x: 5, y: 5 }, width: 4, height: 6, depth: 4, angle: 0 },
    { center: { x: 15, y: 5 }, width: 4, height: 6, depth: 4, angle: 0.3 },
  ];
  const slice = { walls: [[{ x: 0, y: 0 }, { x: 50, y: 0 }]] }; // 3 pieces of <= 20 m
  const services = createServices();
  services.provide(WorldDataKey, { slice, buildings, terrain } as never);
  const scope = createScope();
  const ctx = { services, physics: { rapier: RAPIER, world }, own: scope.own } as unknown as GameContext;
  const quiet = console.log;
  console.log = () => {};
  try { await worldPhysics.setup(ctx); } finally { console.log = quiet; }
  assert.equal(world.colliders.len(), 1 + 2 + 3);
  assert.equal(world.bodies.len(), 1);
  scope.dispose();
  assert.equal(world.colliders.len(), 0);
  assert.equal(world.bodies.len(), 0);
  world.free();
});

// wiring guards: world-view cannot run in node (WebGPU/DOM), so check the plugins are wired to the contract.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = (f: string): string => readFileSync(join(import.meta.dirname, '..', f), 'utf8');

test('wiring: world-view owns its scene additions and labels; world-physics owns its body; game disposes plugin scopes on stop', () => {
  const view = src('src/plugins/world-view.ts');
  // Card 8: the sector content is built through the host, whose per-build Scope (`own`) replaces ctx.own; the host itself is owned by the plugin.
  assert.match(view, /ownSceneAdditions\(ctx\.view\.scene, own, \(\) => \{ pending = build\(ctx\); \}\)/);
  assert.match(view, /own\(createWorldLabels\(/);
  assert.match(view, /ctx\.own\(\(\) => host\.unload\(\)\)/);
  assert.match(src('src/plugins/world-physics.ts'), /\bown\(\(\) => world\.removeRigidBody\(body\)\)/);
  const game = src('src/engine/game.ts');
  assert.match(game, /scopes\.disposeAll\(\)/);
  assert.match(game, /stop\(\) \{[\s\S]*disposePlugins\(\)/);
});

// (e) Rapier World + window/document listeners (card 6b) ---------------------------------------------
import { createPhysics } from '../src/engine/physics.ts';

test('physics.free: frees the World exactly once, even when called twice', async () => {
  const physics = await createPhysics();
  let calls = 0;
  const real = physics.world.free.bind(physics.world);
  physics.world.free = () => { calls++; real(); };
  physics.free();
  physics.free();
  assert.equal(calls, 1);
});

test('wiring: game owns physics.free in rootScope, which is disposed only after every plugin scope', () => {
  const game = src('src/engine/game.ts');
  assert.match(game, /rootScope\.own\(\(\) => physics\.free\(\)\)/);
  const body = game.slice(game.indexOf('const disposePlugins'));
  const plugins = body.indexOf('scopes.disposeAll()');
  const root = body.indexOf('rootScope.dispose()');
  assert.ok(plugins >= 0 && root > plugins, 'plugin scopes disposed before rootScope');
  assert.equal(game.split('physics.free()').length - 1, 1, 'physics.free called from one place only');
});

test('wiring: debug-mode and camera-settings remove their window/document listeners through ctx.own', () => {
  const dbg = src('src/plugins/debug-mode.ts');
  assert.match(dbg, /window\.addEventListener\('wheel', onWheel[^)]*\);\s*ctx\.own\(\(\) => window\.removeEventListener\('wheel', onWheel\)\)/);
  const cam = src('src/plugins/camera-settings.ts');
  assert.match(cam, /ctx\.own\(\(\) => document\.removeEventListener\('click', onClick\)\)/);
  assert.match(cam, /ctx\.own\(\(\) => document\.removeEventListener\('pointerlockchange', onLockChange\)\)/);
});
