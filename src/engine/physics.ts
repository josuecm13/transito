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
