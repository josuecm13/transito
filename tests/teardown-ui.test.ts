import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Scene } from 'three/webgpu';
import { createScope } from '../src/ecs/scope.ts';
import { createServices } from '../src/ecs/services.ts';
import { createEcs } from '../src/ecs/world.ts';
import type { GameContext, GamePlugin, System } from '../src/ecs/plugin.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { CameraControlKey, DebugModeKey, LandCoverKey, ScreensKey, WorldDataKey } from '../src/plugins/keys.ts';
import type { Screen } from '../src/ui/screens.ts';
import { pedestrians } from '../src/plugins/pedestrians.ts';
import { minimap } from '../src/plugins/minimap.ts';
import { worldMap } from '../src/plugins/world-map.ts';

// ---- fake DOM (only what minimap / world-map touch) ---------------------------------------------------
interface FakeEl {
  tag: string;
  id: string;
  width: number;
  height: number;
  style: Record<string, string>;
  children: FakeEl[];
  parent?: FakeEl;
  removed: boolean;
  clientWidth: number;
  clientHeight: number;
  append(...c: FakeEl[]): void;
  remove(): void;
  setAttribute(): void;
  addEventListener(type: string, fn: unknown, opts?: { signal?: AbortSignal }): void;
  getContext(): unknown;
  getBoundingClientRect(): { left: number; top: number };
  animate(): { cancel(): void };
  setPointerCapture(): void;
}
const created: FakeEl[] = [];
let liveListeners = 0;
const track = (opts?: { signal?: AbortSignal }): void => {
  liveListeners++;
  opts?.signal?.addEventListener('abort', () => liveListeners--, { once: true });
};
/** A 2D context that accepts every call and returns a harmless value. */
const ctx2d = (): unknown =>
  new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.min(w * h * 4, 1024)), width: w, height: h });
        if (k === 'canvas') return created[0];
        if (k === 'measureText') return () => ({ width: 1 });
        return () => ctx2d();
      },
      set: () => true,
    },
  );
const el = (tag: string): FakeEl => {
  const e: FakeEl = {
    tag, id: '', width: 300, height: 150, style: {}, children: [], removed: false, clientWidth: 800, clientHeight: 600,
    append(...c) { for (const x of c) { x.parent = e; e.children.push(x); } },
    remove() { e.removed = true; if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); },
    setAttribute() {}, addEventListener(_t, _f, o) { track(o); }, getContext: () => ctx2d(),
    getBoundingClientRect: () => ({ left: 0, top: 0 }), animate: () => ({ cancel() {} }), setPointerCapture() {},
  };
  created.push(e);
  return e;
};
function installDom(): void {
  Object.assign(globalThis, {
    document: { createElement: (t: string) => el(t) },
    window: { devicePixelRatio: 1, innerWidth: 800, innerHeight: 600, addEventListener: (_t: string, _f: unknown, o?: { signal?: AbortSignal }) => track(o) },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
}

// ---- shared harness ---------------------------------------------------------------------------------------
const data = buildWorldData(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));

/** Fake Rapier that only counts bodies and colliders. */
function fakePhysics() {
  const st = { bodies: new Set<number>(), created: 0, removed: 0 };
  let h = 0;
  const desc = { setTranslation: () => desc };
  return {
    st,
    physics: {
      rapier: { RigidBodyDesc: { kinematicPositionBased: () => desc }, ColliderDesc: { capsule: () => ({}) } },
      world: {
        createRigidBody: () => { const b = { handle: ++h }; st.bodies.add(b.handle); st.created++; return b; },
        createCollider: () => ({}),
        removeRigidBody: (b: { handle: number }) => { st.bodies.delete(b.handle); st.removed++; },
      },
    },
  };
}

function harness(extra: Partial<GameContext> = {}) {
  const scope = createScope();
  const services = createServices();
  services.provide(WorldDataKey, { ...data, terrain: { heightAt: () => 0 } } as never);
  const systems: System[] = [];
  const ui = el('div');
  const ctx = {
    ecs: createEcs(), services, ui, own: scope.own, addSystem: (s: System) => systems.push(s),
    view: { scene: new Scene() }, ...extra,
  } as unknown as GameContext;
  return { ctx, scope, systems, ui };
}
const run = (p: GamePlugin, c: GameContext): void => void p.setup(c);

// ---- pedestrians ------------------------------------------------------------------------------------------
function pedsRun() {
  const ph = fakePhysics();
  const h = harness({ physics: ph.physics as never });
  run(pedestrians, h.ctx);
  const mesh = h.ctx.view.scene.children[0] as unknown as { geometry: { dispose(): void }; material: { dispose(): void } };
  const counts = { geo: 0, mat: 0 };
  const g = mesh.geometry.dispose.bind(mesh.geometry);
  const m = mesh.material.dispose.bind(mesh.material);
  mesh.geometry.dispose = () => { counts.geo++; g(); };
  mesh.material.dispose = () => { counts.mat++; m(); };
  const plan = h.systems.find((s) => s.name === 'pedestrians-plan') as System;
  for (let i = 0; i < 40; i++) plan.run(h.ctx, { dt: 1, elapsed: i, frame: i });
  // Move the population focus onto a pedestrian so the LOD hands it a physics body.
  const first = [...h.ctx.ecs.with('pedestrian')][0];
  if (first) h.ctx.ecs.add({ populationFocus: true, position: { ...first.position } } as never);
  plan.run(h.ctx, { dt: 1, elapsed: 41, frame: 41 });
  return { ...h, ph, counts };
}

test('pedestrians: teardown removes the mesh, disposes geometry+material, frees every body, empties the pool', () => {
  const r = pedsRun();
  const pool = [...r.ctx.ecs.with('pedestrian')].length;
  assert.ok(pool > 0, 'precondition: pedestrians spawned');
  assert.ok(r.ph.st.bodies.size > 0, 'precondition: some pedestrian has a physics body');
  assert.equal(r.ctx.view.scene.children.length, 1);
  r.scope.dispose();
  assert.equal(r.ctx.view.scene.children.length, 0, 'mesh removed from scene');
  assert.deepEqual(r.counts, { geo: 1, mat: 1 });
  assert.equal(r.ph.st.bodies.size, 0, 'no physics body left');
  assert.equal([...r.ctx.ecs.with('pedestrian')].length, 0, 'pool empty');
  assert.equal(r.scope.live, 0);
});

test('pedestrians: a second setup on the same ecs starts empty and works', () => {
  const r = pedsRun();
  r.scope.dispose();
  const ph2 = fakePhysics();
  const scope2 = createScope();
  const ctx2 = { ...r.ctx, own: scope2.own, physics: ph2.physics, addSystem: (s: System) => r.systems.push(s) } as unknown as GameContext;
  r.systems.length = 0;
  run(pedestrians, ctx2);
  assert.equal([...ctx2.ecs.with('pedestrian')].length, 0);
  const plan = r.systems.find((s) => s.name === 'pedestrians-plan') as System;
  assert.doesNotThrow(() => plan.run(ctx2, { dt: 1, elapsed: 0, frame: 0 }));
  scope2.dispose();
  assert.equal(ph2.st.bodies.size, 0);
});

// ---- minimap ---------------------------------------------------------------------------------------------
test('minimap: teardown removes the canvas from the DOM and releases every canvas backing store', () => {
  installDom();
  created.length = 0;
  const services = createServices();
  const h = harness();
  h.ctx.services.provide(CameraControlKey, { chase: false, yaw: 0 } as never);
  h.ctx.services.provide(LandCoverKey, undefined as never);
  // sharedStaticLayer needs a renderable world: the fake 2D context accepts all drawing.
  void services;
  run(minimap, h.ctx);
  const canvas = h.ui.children.find((c) => c.id === 'minimap') as FakeEl;
  assert.ok(canvas, 'minimap canvas appended to ui');
  const rim = created.find((c) => c.tag === 'canvas' && c !== canvas && c.width > 0 && c.id === '') as FakeEl;
  const layer = created.filter((c) => c.tag === 'canvas' && c !== canvas && c !== rim);
  assert.ok(rim.width > 0 && layer.length > 0);
  h.scope.dispose();
  assert.ok(canvas.removed && h.ui.children.length === 0, 'canvas removed from DOM');
  assert.equal(canvas.width + canvas.height, 0);
  assert.equal(rim.width + rim.height, 0, 'rimBuf released');
  for (const l of layer) assert.equal(l.width + l.height, 0, 'layer canvas released');
});

// ---- world-map -------------------------------------------------------------------------------------------
test('world-map: teardown closes the open session (host removed, listeners aborted, canvases freed)', () => {
  installDom();
  created.length = 0;
  liveListeners = 0;
  const screens: { screen?: Screen } = {};
  const h = harness();
  h.ctx.services.provide(ScreensKey, {
    register: (s: Screen) => { screens.screen = s; }, addMenuEntry() {}, addShortcut() {}, closeAll() {},
  } as never);
  h.ctx.services.provide(DebugModeKey, { active: false } as never);
  h.ctx.services.provide(LandCoverKey, { classes: ['forest'] } as never);
  run(worldMap, h.ctx);
  const root = el('div');
  (screens.screen as Screen).mount(root as never);
  const host = root.children.find((c) => c.id === 'world-map') as FakeEl;
  assert.ok(host, 'host mounted');
  assert.ok(liveListeners >= 8, `listeners registered (${liveListeners})`);
  const canvases = created.filter((c) => c.tag === 'canvas');
  assert.ok(canvases.some((c) => c.width > 0));
  h.scope.dispose();
  assert.ok(host.removed && root.children.length === 0, 'host removed');
  assert.equal(liveListeners, 0, 'every listener aborted');
  const hostCanvas = host.children.find((c) => c.tag === 'canvas') as FakeEl;
  assert.equal(hostCanvas.width + hostCanvas.height, 0, 'host canvas released');
});
