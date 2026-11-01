import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planPopulation } from '../src/sim/population.ts';
import type { PopulationInput } from '../src/sim/population.ts';
import { stepFollower } from '../src/sim/follower.ts';
import type { FollowerState } from '../src/sim/follower.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { pointOnEdge } from '../src/world/walk-graph.ts';
import { createRng } from '../src/world/rng.ts';
import { distance } from '../src/world/vec.ts';
import type { Vec2 } from '../src/world/vec.ts';

const { spec, slice, walkGraph: graph } = buildWorldData(
  readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'),
);
const ped = spec.population.pedestrians;
const base = {
  budget: ped.budget,
  spawnRing: ped.spawnRing,
  despawnAt: ped.despawnAt,
  maxSpawnsPerTick: 3,
};
const spawnP = { x: slice.spawn.position.x, y: slice.spawn.position.y };

type Agent = FollowerState & { id: number };

/** Run n ticks with a focus walking along a line; returns per-tick stats. */
function simulate(seed: number, ticks: number) {
  const rng = createRng(seed);
  let agents: Agent[] = [];
  let nextId = 1;
  const log: { alive: number; spawnDistances: number[] }[] = [];
  for (let k = 0; k < ticks; k++) {
    const focus: Vec2 = { x: spawnP.x + k * 4, y: spawnP.y };
    const input: PopulationInput = {
      ...base,
      focus,
      agents: agents.map((a) => ({ id: a.id, p: pointOnEdge(graph, a.edge, a.t) })),
    };
    const plan = planPopulation(input, graph, rng);
    const dead = new Set(plan.despawn);
    agents = agents.filter((a) => !dead.has(a.id));
    const spawnDistances: number[] = [];
    for (const s of plan.spawn) {
      agents.push({ id: nextId++, edge: s.edge, t: s.t, forward: s.forward, blocked: false });
      spawnDistances.push(distance(pointOnEdge(graph, s.edge, s.t), focus));
    }
    for (const a of agents) stepFollower(a, 1.3 * 4, graph, rng);
    log.push({ alive: agents.length, spawnDistances });
  }
  return log;
}

test('never exceeds the budget across 200 ticks with a moving focus; and actually fills it', () => {
  const log = simulate(3, 200);
  for (const l of log) assert.ok(l.alive <= base.budget, `alive ${l.alive} > ${base.budget}`);
  assert.ok(Math.max(...log.map((l) => l.alive)) > 0);
});

test('every spawn point is within the ring at spawn time', () => {
  const all = simulate(5, 200).flatMap((l) => l.spawnDistances);
  assert.ok(all.length > 0);
  for (const d of all) assert.ok(d >= base.spawnRing[0] && d <= base.spawnRing[1], `distance ${d}`);
});

test('agents beyond despawnAt are despawned, others kept', () => {
  const focus = spawnP;
  const agents = [
    { id: 1, p: { x: focus.x + base.despawnAt + 1, y: focus.y } },
    { id: 2, p: { x: focus.x + base.despawnAt - 1, y: focus.y } },
    { id: 3, p: { x: focus.x, y: focus.y - base.despawnAt - 50 } },
  ];
  const plan = planPopulation({ ...base, focus, agents }, graph, createRng(1));
  assert.deepEqual(plan.despawn.sort(), [1, 3]);
});

test('deterministic for the same seed, different for another', () => {
  assert.deepEqual(simulate(9, 60), simulate(9, 60));
  assert.notDeepEqual(simulate(9, 60), simulate(10, 60));
});

test('focus far from every edge: zero spawns, returns quickly', () => {
  const t0 = performance.now();
  const plan = planPopulation({ ...base, focus: { x: -1e6, y: -1e6 }, agents: [] }, graph, createRng(1));
  assert.equal(plan.spawn.length, 0);
  assert.ok(performance.now() - t0 < 100);
});

test('respects maxSpawnsPerTick and free budget', () => {
  const plan = planPopulation({ ...base, focus: spawnP, agents: [] }, graph, createRng(2));
  assert.ok(plan.spawn.length <= base.maxSpawnsPerTick);
  const full = Array.from({ length: base.budget }, (_, i) => ({ id: i, p: spawnP }));
  assert.equal(planPopulation({ ...base, focus: spawnP, agents: full }, graph, createRng(2)).spawn.length, 0);
});
