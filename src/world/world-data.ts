import type { WorldSpec } from './spec.ts';
import { parseWorldSpec } from './spec.ts';
import type { WorldSlice } from './slice.ts';
import { sliceWorld } from './slice.ts';
import type { StreetNetwork } from './streets/generate.ts';
import { generateStreets } from './streets/generate.ts';
import type { City } from './streets/city.ts';
import { deriveCity } from './streets/city.ts';
import type { CityBuilding } from './streets/buildings.ts';
import type { StreetWalkGraph } from './walk-graph.ts';
import { Terrain } from './terrain.ts';
import { buildWalkGraph } from './walk-graph.ts';
import { layer2Relief } from './layers/layer2-relief.ts';
import { layer3Water } from './layers/layer3-water.ts';
import type { Layer3Output } from './layers/layer3-water.ts';

/**
 * Everything the plugins render, collide with and walk on. Built once, never regenerated.
 * `buildings` is `city.buildings` (CityBuilding is a superset of the blockout Building).
 */
export type WorldData = {
  spec: WorldSpec;
  slice: WorldSlice;
  streets: StreetNetwork;
  city: City;
  buildings: CityBuilding[];
  walkGraph: StreetWalkGraph;
  /** Ground height model shared by physics, rendering and every system that stands on the ground. */
  terrain: Terrain;
  /** Layer 3: derived rivers, canal, Gatún Lake, locks (and the carve already applied to `terrain`). */
  water: Layer3Output;
};

export function buildWorldData(rawYaml: string): WorldData {
  const spec = parseWorldSpec(rawYaml);
  const slice = sliceWorld(spec);
  const streets = generateStreets(spec, slice);
  const city = deriveCity(spec, slice, streets);
  const walkGraph = buildWalkGraph(streets.graph, slice.isPlayableLand, spec.population.pedestrians.walkOn);
  // Layers 2-3 (whole isthmus): H0 baked once, rivers / canal / lake carved on top of it. Layer 1 is not needed numerically.
  const layer2 = layer2Relief(spec, {});
  const water = layer3Water(spec, { layer2 });
  const terrain = new Terrain(spec, slice.rect, streets.graph, { layer2, layer3: water });
  return { spec, slice, streets, city, buildings: city.buildings, walkGraph, terrain, water };
}
