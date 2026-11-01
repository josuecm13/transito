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
import { buildWalkGraph } from './walk-graph.ts';

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
};

export function buildWorldData(rawYaml: string): WorldData {
  const spec = parseWorldSpec(rawYaml);
  const slice = sliceWorld(spec);
  const streets = generateStreets(spec, slice);
  const city = deriveCity(spec, slice, streets);
  const walkGraph = buildWalkGraph(streets.graph, slice.isPlayableLand, spec.population.pedestrians.walkOn);
  return { spec, slice, streets, city, buildings: city.buildings, walkGraph };
}
