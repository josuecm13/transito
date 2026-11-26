import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSectorHost, formatReloadLine } from '../src/ecs/sector-host.ts';
import type { SectorStep } from '../src/ecs/sector-host.ts';
import { createServices } from '../src/ecs/services.ts';
import { createScope } from '../src/ecs/scope.ts';
import type { GameContext, System } from '../src/ecs/plugin.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { SectorHostKey, WorldDataKey } from '../src/plugins/keys.ts';
import { worldPhysics } from '../src/plugins/world-physics.ts';

const src = (f: string): string => readFileSync(join(import.meta.dirname, '..', f), 'utf8');

/** Steps that count builds and disposals; each owns `perStep` disposers. */
function probe(names: string[], perStep = 2) {
  const log: string[] = [];
  const built: Record<string, number> = {};
  const disposed: Record<string, number> = {};
  const steps: SectorStep[] = names.map((name) => ({
    name,
    build(own) {
      built[name] = (built[name] ?? 0) + 1;
      log.push(`+${name}`);
      for (let i = 0; i < perStep; i++) {
        own(() => {
          disposed[name] = (disposed[name] ?? 0) + 1;
          log.push(`-${name}${i}`);
        });
      }
    },
  }));
  return { steps, log, built, disposed };
}

test('host: build -> resident, generation 1', () => {
  const p = probe(['a', 'b']);
  const host = createSectorHost({ steps: p.steps });
  assert.equal(host.state, 'unloaded');
  assert.equal(host.generation, 0);
  host.build();
  assert.equal(host.state, 'resident');
  assert.equal(host.generation, 1);
  assert.equal(host.live, 4);
});

test('host: reload x5 runs every step 6 times, every disposer 5 times, live count stays flat', () => {
  const p = probe(['a', 'b', 'c']);
  const host = createSectorHost({ steps: p.steps });
  host.build();
  const oneSector = host.live;
  assert.equal(oneSector, 6);
  for (let i = 1; i <= 5; i++) {
    host.reload();
    assert.equal(host.live, oneSector, `live after reload ${i}`);
    assert.equal(host.state, 'resident');
  }
  assert.equal(host.generation, 6);
  for (const n of ['a', 'b', 'c']) {
    assert.equal(p.built[n], 6, `${n} built`);
    assert.equal(p.disposed[n], 5 * 2, `${n} disposers (2 per build x 5 freed builds)`);
  }
});

test('host: unload frees everything, unloading twice is a no-op, build works again after', () => {
  const p = probe(['a']);
  const host = createSectorHost({ steps: p.steps });
  host.build();
  host.unload();
  assert.equal(host.state, 'unloaded');
  assert.equal(host.live, 0);
  assert.equal(p.disposed['a'], 2);
  host.unload();
  assert.equal(p.disposed['a'], 2, 'second unload disposes nothing');
  host.build();
  assert.equal(host.generation, 2);
});

test('host: build while resident is refused (no sector built twice)', () => {
  const p = probe(['a']);
  const host = createSectorHost({ steps: p.steps });
  host.build();
  assert.throws(() => host.build(), /already resident/);
  assert.equal(p.built['a'], 1);
  assert.equal(host.live, 2);
});

test('host: disposal order is the reverse of build order', () => {
  const p = probe(['a', 'b'], 2);
  const host = createSectorHost({ steps: p.steps });
  host.build();
  p.log.length = 0;
  host.unload();
  assert.deepEqual(p.log, ['-b1', '-b0', '-a1', '-a0']);
});

test('host: a throwing step disposes the earlier steps, leaves the sector unloaded and rethrows', () => {
  const p = probe(['a', 'b']);
  const boom = new Error('boom');
  const steps: SectorStep[] = [...p.steps, { name: 'bad', build() { throw boom; } }];
  const host = createSectorHost({ steps });
  assert.throws(() => host.build(), (e: unknown) => e === boom);
  assert.equal(host.state, 'unloaded');
  assert.equal(host.generation, 0);
  assert.equal(host.live, 0);
  assert.equal(p.disposed['a'], 2);
  assert.equal(p.disposed['b'], 2);
});

test('host: a failing reload leaves nothing half-built, and a later build recovers', () => {
  let fail = false;
  const p = probe(['a']);
  const steps: SectorStep[] = [...p.steps, { name: 'flaky', build() { if (fail) throw new Error('late'); } }];
  const host = createSectorHost({ steps });
  host.build();
  fail = true;
  assert.throws(() => host.reload(), /late/);
  assert.equal(host.state, 'unloaded');
  assert.equal(p.disposed['a'], 4, 'first build freed by unload, second rolled back');
  fail = false;
  host.build();
  assert.equal(host.state, 'resident');
});

test('host: disposer errors are aggregated and the sector is still marked unloaded', () => {
  const host = createSectorHost({ steps: [{ name: 'x', build(own) { own(() => { throw new Error('d1'); }); own(() => { throw new Error('d2'); }); } }] });
  host.build();
  assert.throws(() => host.unload(), (e: unknown) => e instanceof AggregateError && e.errors.length === 2);
  assert.equal(host.state, 'unloaded');
});

test('host: add() joins a resident sector live and is rebuilt by reload; the first add builds', () => {
  const host = createSectorHost();
  const a = probe(['a']);
  const b = probe(['b']);
  host.add(a.steps[0] as SectorStep);
  assert.equal(host.state, 'resident');
  host.add(b.steps[0] as SectorStep);
  assert.equal(b.built['b'], 1, 'joined live');
  assert.equal(host.live, 4);
  host.reload();
  assert.equal(host.live, 4);
  assert.deepEqual([a.built['a'], b.built['b']], [2, 2]);
});

test('reload line format', () => {
  assert.equal(
    formatReloadLine(3, { children: 12, geometries: 40, colliders: 1746, heapMb: 210 }),
    '[sector] act1 reload #3: scene children=12, geometries=40, colliders=1746, JS heap MB=210',
  );
  assert.match(formatReloadLine(1, { children: 1 }), /geometries=n\/a, colliders=n\/a, JS heap MB=n\/a/);
});

// ---- real Rapier + real world data, through the host --------------------------------------------------------
test('world-physics through the host: collider count identical after 1 and 5 reloads, 0 after unload', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const data = buildWorldData(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
  const services = createServices();
  services.provide(WorldDataKey, data);
  const scope = createScope();
  const ctx = { services, physics: { rapier: RAPIER, world }, own: scope.own } as unknown as GameContext;
  const quiet = console.log;
  console.log = () => {};
  try {
    await worldPhysics.setup(ctx);
    const host = services.get(SectorHostKey);
    const first = world.colliders.len();
    assert.ok(first > 1000, `precondition: a real sector worth of colliders (${first})`);
    assert.equal(world.bodies.len(), 1);
    host.reload();
    assert.equal(world.colliders.len(), first, 'after 1 reload');
    assert.equal(world.bodies.len(), 1);
    for (let i = 0; i < 4; i++) host.reload();
    assert.equal(host.generation, 6);
    assert.equal(world.colliders.len(), first, 'after 5 reloads');
    assert.equal(world.bodies.len(), 1);
    host.unload();
    assert.equal(world.colliders.len(), 0, 'after unload');
    assert.equal(world.bodies.len(), 0);
    host.build();
    assert.equal(world.colliders.len(), first, 'rebuilt from the same WorldData');
    scope.dispose(); // plugin teardown frees the sector too
    assert.equal(world.colliders.len(), 0);
  } finally {
    console.log = quiet;
    world.free();
  }
});

// ---- wiring (world-view needs WebGPU/DOM; the source is checked) -----------------------------------------------
test('wiring: world-view builds through the host, registers labels once, frees the M0 layer, provides land cover once', () => {
  const view = src('src/plugins/world-view.ts');
  assert.match(view, /createSectorHost\(\)/);
  assert.match(view, /ctx\.services\.provide\(SectorHostKey, host\)/);
  assert.match(view, /host\.add\(\{\s*name: 'world-view:scene',\s*build: \(own\) => ownSceneAdditions\(ctx\.view\.scene, own,/);
  assert.match(view, /releaseSharedLayer\(data\)/);
  assert.equal(view.match(/ctx\.services\.provide\(LandCoverKey/g)?.length, 1);
  assert.equal(view.match(/ctx\.addSystem\(/g)?.length, 1, 'one system, registered once outside the sector build');
  assert.match(view, /run: \(\) => worldLabels\?\.update\(\)/);
  assert.match(view, /own\(\(\) => \{ if \(worldLabels === labels\) worldLabels = undefined; \}\)/);
});

test('wiring: world-view labels system no-ops while unloaded and survives reload without a second registration', () => {
  // Behavioural stand-in for the DOM-bound plugin: the same pattern the plugin source is checked for above.
  const systems: System[] = [];
  let labels: { update(): void } | undefined;
  let updates = 0;
  systems.push({ name: 'world-labels', phase: 'render', run: () => labels?.update() } as System);
  const host = createSectorHost({
    steps: [{ name: 'labels', build(own) { const l = own({ update: () => updates++, dispose() {} }); labels = l; own(() => { if (labels === l) labels = undefined; }); } }],
  });
  const tick = (): void => systems[0]?.run(undefined as never, undefined as never);
  tick();
  assert.equal(updates, 0, 'unloaded: no-op');
  host.build();
  tick();
  host.reload();
  tick();
  assert.equal(updates, 2);
  host.unload();
  tick();
  assert.equal(updates, 2, 'unloaded again: no-op');
  assert.equal(systems.length, 1);
});

test('wiring: the debug key (F4) reloads the sector, only while debug is active', () => {
  const dbg = src('src/plugins/debug-mode.ts');
  assert.match(dbg, /isDown\('F4'\)/);
  assert.match(dbg, /if \(f4 && !f4Was && active\) reloadSector\(\)/);
  assert.match(dbg, /const reloadSector = \(\): void => \{\s*sector\.reload\(\);/);
  assert.match(dbg, /formatReloadLine\(/);
});

test('wiring: minimap and world-map re-fetch the shared M0 layer instead of caching it', () => {
  const mm = src('src/plugins/minimap.ts');
  assert.match(mm, /const layer = sharedStaticLayer\(data, cover\);/);
  assert.match(mm, /sector\?\.state === 'unloaded'\) return/);
  assert.match(src('src/plugins/world-map.ts'), /detail\.layer = sharedStaticLayer\(data,/);
});
