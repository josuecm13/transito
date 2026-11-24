import RAPIER from '@dimforge/rapier3d-compat';

export interface Physics {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  step(dt: number): void;
}

export async function createPhysics(): Promise<Physics> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  return {
    rapier: RAPIER,
    world,
    step(dt) {
      world.timestep = dt;
      world.step();
    },
  };
}

/**
 * Collision groups. The terrain heightfield is the only collider in GROUND_MEMBERSHIP. A floating
 * kinematic body that sets its own height from the terrain (the car) queries with
 * `IGNORE_GROUND_GROUPS`, so the ground never blocks its sideways shape-casts; everything else
 * (default groups: member of all, collides with all) still sees the ground.
 */
export const GROUND_MEMBERSHIP = 0x0002;
export const GROUND_GROUPS = ((GROUND_MEMBERSHIP << 16) | 0xffff) >>> 0;
export const IGNORE_GROUND_GROUPS = ((0xffff << 16) | (0xffff & ~GROUND_MEMBERSHIP)) >>> 0;
