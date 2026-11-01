import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stepFollower, followerPose } from '../src/sim/follower.ts';
import type { FollowerState } from '../src/sim/follower.ts';
import type { WalkGraph } from '../src/world/walk-graph.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { createRng } from '../src/world/rng.ts';
import { distance } from '../src/world/vec.ts';

/** 0 --e0(10m)--> 1 --e1(10m)--> 2, plus a Y-branch e2 from 1 up to 3. */
function graph(branch: boolean): WalkGraph {
  const nodes = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 10, y: 10 },
  ];
  const edges = [
    { a: 0, b: 1, length: 10, kind: 'sidewalk' as const },
    { a: 1, b: 2, length: 10, kind: 'sidewalk' as const },
    ...(branch ? [{ a: 1, b: 3, length: 10, kind: 'sidewalk' as const }] : []),
  ];
  const adjacency: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    (adjacency[e.a] as number[]).push(i);
    (adjacency[e.b] as number[]).push(i);
  });
  return { nodes, edges, adjacency };
}
const fs = (edge: number, t: number, forward: boolean): FollowerState => ({ edge, t, forward, blocked: false });

test('carries the remainder across a node', () => {
  const f = fs(0, 0.5, true);
  stepFollower(f, 8, graph(false), createRng(1)); // 5 m to node 1, 3 m onto e1
  assert.equal(f.edge, 1);
  assert.equal(f.forward, true);
  assert.ok(Math.abs(f.t - 0.3) < 1e-9);
});

test('walks away from the node on an edge entered at its b end', () => {
  const f = fs(1, 0.5, false); // heading to node 1 via e1 backwards
  stepFollower(f, 8, graph(false), createRng(1));
  assert.equal(f.edge, 0);
  assert.equal(f.forward, false);
  assert.ok(Math.abs(f.t - 0.7) < 1e-9);
});

test('never backtracks when another edge exists', () => {
  const g = graph(true);
  for (let seed = 0; seed < 50; seed++) {
    const f = fs(0, 0.9, true);
    stepFollower(f, 3, g, createRng(seed));
    assert.notEqual(f.edge, 0, `seed ${seed} turned back`);
  }
});

test('turns back at a dead end', () => {
  const f = fs(1, 0.9, true);
  stepFollower(f, 3, graph(false), createRng(1)); // 1 m to dead end node 2, then 2 m back
  assert.equal(f.edge, 1);
  assert.equal(f.forward, false);
  assert.ok(Math.abs(f.t - 0.8) < 1e-9);
});

test('lane offset is to the right of heading; opposite headings use opposite sides', () => {
  const g = graph(false);
  const east = followerPose(fs(0, 0.5, true), g, 0.7);
  assert.deepEqual(east.heading, { x: 1, y: 0 });
  assert.ok(Math.abs(east.position.y - -0.7) < 1e-9); // right of east is south
  assert.ok(Math.abs(east.position.x - 5) < 1e-9);
  const west = followerPose(fs(0, 0.5, false), g, 0.7);
  assert.deepEqual(west.heading, { x: -1, y: 0 });
  assert.ok(Math.abs(west.position.y - 0.7) < 1e-9);
});

test('real graph: walking a long way stays on the graph, never jumps', () => {
  const { walkGraph: g } = buildWorldData(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
  const rng = createRng(7);
  const f = fs(0, 0.5, true);
  let prev = followerPose(f, g, 0).position;
  for (let i = 0; i < 20000; i++) {
    stepFollower(f, 0.5, g, rng);
    assert.ok(f.t >= 0 && f.t <= 1);
    const p = followerPose(f, g, 0).position;
    // A step crossing a node may cut a corner, but never farther than the distance walked.
    assert.ok(distance(p, prev) <= 0.5 + 1e-6);
    prev = p;
  }
});
