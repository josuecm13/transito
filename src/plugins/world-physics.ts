import type { GameContext, GamePlugin } from '../ecs/plugin.ts';
import { SectorHostKey, WorldDataKey } from './keys.ts';
import { createSectorHost, type SectorHost } from '../ecs/sector-host.ts';
import type { Scope } from '../ecs/scope.ts';
import { specAngleToSceneYaw, specToScene } from '../world/coords.ts';
import { GROUND_GROUPS } from '../engine/physics.ts';

const WALL_THICKNESS = 0.5;
const WALL_HEIGHT = 3;
/** Walls are cut into pieces of at most this length (m) and sunk this far (m) below the lowest ground under each piece. */
const WALL_PIECE = 20;
const WALL_SINK = 2;

const yawQuat = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export const worldPhysics: GamePlugin = {
  name: 'world-physics',
  dependsOn: ['world-data', 'world-view'],
  setup(ctx) {
    // Act 1 is sector #1: join the host world-view provides (a standalone host when it is absent, e.g. in tests).
    let host: SectorHost;
    if (ctx.services.has(SectorHostKey)) host = ctx.services.get(SectorHostKey);
    else {
      host = createSectorHost();
      ctx.services.provide(SectorHostKey, host);
      ctx.own(() => host.unload());
    }
    host.add({ name: 'world-physics:body', build: (own) => buildBody(ctx, own) });
  },
};

function buildBody(ctx: GameContext, own: Scope['own']): void {
  const { slice, buildings, terrain } = ctx.services.get(WorldDataKey);
  const { rapier: R, world } = ctx.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  // Removing the fixed body also removes every collider attached to it.
  own(() => world.removeRigidBody(body));
  let count = 0;

  // Ground: a heightfield over the baked terrain (active rect + skirt).
  const hf = terrain.heightfield();
  world.createCollider(
    R.ColliderDesc.heightfield(hf.nrows, hf.ncols, hf.heights, hf.scale)
      .setTranslation(hf.center.x, 0, hf.center.z)
      .setCollisionGroups(GROUND_GROUPS),
    body,
  );
  count++;

  for (const b of buildings) {
    const c = specToScene(b.center, terrain.footprintBase(b) + b.height / 2);
    world.createCollider(
      R.ColliderDesc.cuboid(b.width / 2, b.height / 2, b.depth / 2)
        .setTranslation(c.x, c.y, c.z)
        .setRotation(yawQuat(specAngleToSceneYaw(b.angle))),
      body,
    );
    count++;
  }

  for (const [a, b] of slice.walls) {
    const total = Math.hypot(b.x - a.x, b.y - a.y);
    if (total < 1e-6) continue;
    const yaw = specAngleToSceneYaw(Math.atan2(b.y - a.y, b.x - a.x));
    // Cut into short pieces so each box can follow the terrain: from below the lowest ground
    // under the piece to WALL_HEIGHT above the highest.
    const pieces = Math.max(1, Math.ceil(total / WALL_PIECE));
    for (let k = 0; k < pieces; k++) {
      const p0 = { x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces };
      const p1 = { x: a.x + ((b.x - a.x) * (k + 1)) / pieces, y: a.y + ((b.y - a.y) * (k + 1)) / pieces };
      const pm = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const hs = [terrain.heightAt(p0.x, p0.y), terrain.heightAt(pm.x, pm.y), terrain.heightAt(p1.x, p1.y)];
      const bottom = Math.min(...hs) - WALL_SINK;
      const top = Math.max(...hs) + WALL_HEIGHT;
      const mid = specToScene(pm, (bottom + top) / 2);
      world.createCollider(
        R.ColliderDesc.cuboid(total / pieces / 2, (top - bottom) / 2, WALL_THICKNESS / 2)
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(yawQuat(yaw)),
        body,
      );
      count++;
    }
  }

  console.log(`[world-physics] colliders=${count} (buildings=${buildings.length}, wall segments=${slice.walls.length}, heightfield=${hf.ncols}x${hf.nrows} cells of ${terrain.grid.cell} m)`);
}
