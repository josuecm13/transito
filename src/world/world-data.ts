import type { WorldSpec } from './spec.ts';
import { parseWorldSpec } from './spec.ts';
import type { WorldSlice } from './slice.ts';
import { sliceWorld } from './slice.ts';
import type { Building } from './blockout.ts';
import { generateBlockout } from './blockout.ts';
import type { WalkGraph } from './walk-graph.ts';
import { buildWalkGraph } from './walk-graph.ts';

export type WorldData = { spec: WorldSpec; slice: WorldSlice; buildings: Building[]; walkGraph: WalkGraph };

export function buildWorldData(rawYaml: string): WorldData {
  const spec = parseWorldSpec(rawYaml);
  const slice = sliceWorld(spec);
  const buildings = generateBlockout(spec, slice);
  const walkGraph = buildWalkGraph(spec, slice);
  return { spec, slice, buildings, walkGraph };
}
