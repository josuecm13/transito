import type { WalkGraph } from '../world/walk-graph.ts';
import { pointOnEdge } from '../world/walk-graph.ts';
import type { Rng } from '../world/rng.ts';
import type { Vec2 } from '../world/vec.ts';
import { distance } from '../world/vec.ts';

export interface PopulationInput {
  focus: Vec2;
  agents: { id: number; p: Vec2 }[];
  budget: number;
  spawnRing: readonly [number, number];
  despawnAt: number;
  maxSpawnsPerTick: number;
}

export interface SpawnPlan {
  edge: number;
  t: number;
  forward: boolean;
}

const ATTEMPTS_PER_SPAWN = 30;

export function planPopulation(
  input: PopulationInput,
  graph: WalkGraph,
  rng: Rng,
): { despawn: number[]; spawn: SpawnPlan[] } {
  const despawn = input.agents.filter((a) => distance(a.p, input.focus) > input.despawnAt).map((a) => a.id);
  const alive = input.agents.length - despawn.length;
  const want = Math.min(input.budget - alive, input.maxSpawnsPerTick);
  const spawn: SpawnPlan[] = [];
  if (want <= 0 || graph.edges.length === 0) return { despawn, spawn };

  const cumulative: number[] = [];
  let total = 0;
  for (const e of graph.edges) cumulative.push((total += e.length));
  if (total <= 0) return { despawn, spawn };
  const [minR, maxR] = input.spawnRing;

  for (let n = 0; n < want; n++) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_SPAWN; attempt++) {
      const x = rng.next() * total;
      let edge = cumulative.findIndex((c) => x < c);
      if (edge < 0) edge = graph.edges.length - 1;
      const t = rng.next();
      const forward = rng.next() < 0.5;
      const d = distance(pointOnEdge(graph, edge, t), input.focus);
      if (d < minR || d > maxR) continue;
      spawn.push({ edge, t, forward });
      break;
    }
  }
  return { despawn, spawn };
}
