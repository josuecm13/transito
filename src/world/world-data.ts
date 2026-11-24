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
import type { LandCover } from './cover.ts';
import { generateIsthmus, type Isthmus } from './proc/isthmus.ts';
import { gameSpecFromIsthmus } from './proc/game-spec.ts';
import { ProcTerrain, coverFromIsthmus, waterFromIsthmus, type GameWater } from './proc/game-world.ts';

/**
 * Everything the plugins render, collide with and walk on. Built once, never regenerated.
 * `buildings` is `city.buildings` (CityBuilding is a superset of the blockout Building).
 */
export type WorldData = {
  /** The game spec: the authored spec with the active area, district grid, routes and Act 1 landmarks of the procedural map. */
  spec: WorldSpec;
  slice: WorldSlice;
  streets: StreetNetwork;
  city: City;
  buildings: CityBuilding[];
  walkGraph: StreetWalkGraph;
  /** Ground height model shared by physics, rendering and every system that stands on the ground (procedural height). */
  terrain: ProcTerrain;
  /** Lake surfaces and rivers of the procedural map (canal water and locks not carried over yet). */
  water: GameWater;
  /** Land cover of the procedural map, in the game's classes. */
  cover: LandCover;
  /** The generated isthmus everything above comes from. */
  isthmus: Isthmus;
};

/**
 * The world the game runs on (#12 2.5): the procedural isthmus (`generateIsthmus`, or `isthmus` when
 * already generated, e.g. baked), with the street / city pipeline run on the Act 1 strip only.
 */
export function buildWorldData(rawYaml: string, isthmus?: Isthmus): WorldData {
  const authored = parseWorldSpec(rawYaml);
  const iso = isthmus ?? generateIsthmus(authored);
  const { spec } = gameSpecFromIsthmus(authored, iso);
  const slice = sliceWorld(spec);
  const streets = generateStreets(spec, slice);
  const city = deriveCity(spec, slice, streets);
  const walkGraph = buildWalkGraph(streets.graph, slice.isPlayableLand, spec.population.pedestrians.walkOn);
  const g = spec.relief.grid;
  const terrain = new ProcTerrain(iso.height, slice.rect, { cell: g.cell, margin: g.margin, farCell: g.far.cell, bounds: spec.bounds });
  const water = waterFromIsthmus(iso, (x, y) => terrain.heightAt(x, y));
  const cover = coverFromIsthmus(iso);
  return { spec, slice, streets, city, buildings: city.buildings, walkGraph, terrain, water, cover, isthmus: iso };
}
