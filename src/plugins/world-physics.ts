import type { GamePlugin } from '../ecs/plugin.ts';
import { WorldDataKey } from './keys.ts';
import { specAngleToSceneYaw, specToScene } from '../world/coords.ts';

const WALL_THICKNESS = 0.5;
const WALL_HEIGHT = 3;
const GROUND_THICKNESS = 1;

const yawQuat = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export const worldPhysics: GamePlugin = {
  name: 'world-physics',
  dependsOn: ['world-data'],
  setup(ctx) {
    const { slice, buildings } = ctx.services.get(WorldDataKey);
    const { rapier: R, world } = ctx.physics;
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    let count = 0;

    // Ground: top face at y = 0, covering the active rect.
    const { minX, maxX, minY, maxY } = slice.rect;
    const center = specToScene({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, -GROUND_THICKNESS / 2);
    world.createCollider(
      R.ColliderDesc.cuboid((maxX - minX) / 2, GROUND_THICKNESS / 2, (maxY - minY) / 2).setTranslation(
        center.x,
        center.y,
        center.z,
      ),
      body,
    );
    count++;

    for (const b of buildings) {
      const c = specToScene(b.center, b.height / 2);
      world.createCollider(
        R.ColliderDesc.cuboid(b.width / 2, b.height / 2, b.depth / 2)
          .setTranslation(c.x, c.y, c.z)
          .setRotation(yawQuat(specAngleToSceneYaw(b.angle))),
        body,
      );
      count++;
    }

    for (const [a, b] of slice.walls) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      const mid = specToScene({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, WALL_HEIGHT / 2);
      const yaw = specAngleToSceneYaw(Math.atan2(b.y - a.y, b.x - a.x));
      world.createCollider(
        R.ColliderDesc.cuboid(len / 2, WALL_HEIGHT / 2, WALL_THICKNESS / 2)
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation(yawQuat(yaw)),
        body,
      );
      count++;
    }

    console.log(`[world-physics] colliders=${count} (buildings=${buildings.length}, walls=${slice.walls.length})`);
  },
};
