import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import type { WorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import type { WorldSlice } from '../src/world/slice.ts';
import { generateBlockout, buildingCorners } from '../src/world/blockout.ts';
import { buildWalkGraph, nextEdge, otherEnd, pointOnEdge } from '../src/world/walk-graph.ts';
import type { WalkGraph } from '../src/world/walk-graph.ts';
import { pointInPolygon } from '../src/world/geometry.ts';
import { createRng } from '../src/world/rng.ts';
import { distance } from '../src/world/vec.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const spec = parseWorldSpec(yaml);
const slice = sliceWorld(spec);
const graph = buildWalkGraph(spec, slice);
const buildings = generateBlockout(spec, slice);

test('graph stats', () => {
  const crossings = graph.edges.filter((e) => e.kind === 'crossing').length;
  console.log(`walk graph nodes=${graph.nodes.length} edges=${graph.edges.length} crossings=${crossings}`);
  assert.ok(graph.nodes.length > 0);
  assert.ok(crossings >= 1);
});

test('every node has degree >= 1 and is playable land', () => {
  graph.nodes.forEach((p, i) => {
    assert.ok((graph.adjacency[i] as number[]).length >= 1, `node ${i}`);
    assert.ok(slice.isPlayableLand(p), `node ${i} at ${p.x},${p.y}`);
  });
  graph.edges.forEach((e, id) => {
    assert.ok(graph.adjacency[e.a]!.includes(id) && graph.adjacency[e.b]!.includes(id));
    assert.ok(Math.abs(e.length - distance(graph.nodes[e.a]!, graph.nodes[e.b]!)) < 1e-9);
  });
});

test('no node lies inside a building footprint', () => {
  const quads = buildings.map((b) => buildingCorners(b));
  for (const [i, p] of graph.nodes.entries()) {
    for (const q of quads) assert.ok(!pointInPolygon(p, q), `node ${i} inside a building`);
  }
});

test('graph is deterministic', () => {
  assert.deepEqual(buildWalkGraph(spec, slice), graph);
});

const line = (): WalkGraph => ({
  // 0 --e0-- 1 --e1-- 2, plus a spur 1 --e2-- 3
  nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 10 }],
  edges: [
    { a: 0, b: 1, length: 10, kind: 'sidewalk' },
    { a: 1, b: 2, length: 10, kind: 'sidewalk' },
    { a: 1, b: 3, length: 10, kind: 'sidewalk' },
  ],
  adjacency: [[0], [0, 1, 2], [1], [2]],
});

test('nextEdge never backtracks when another option exists, turns back at a dead end', () => {
  const g = line();
  const rng = createRng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const e = nextEdge(g, 0, 1, rng);
    assert.notEqual(e, 0);
    seen.add(e);
  }
  assert.deepEqual([...seen].sort(), [1, 2]);
  assert.equal(nextEdge(g, 1, 2, rng), 1);
});

test('otherEnd and pointOnEdge', () => {
  const g = line();
  assert.equal(otherEnd(g, 0, 0), 1);
  assert.equal(otherEnd(g, 0, 1), 0);
  for (const [id, e] of g.edges.entries()) {
    assert.deepEqual(pointOnEdge(g, id, 0), g.nodes[e.a]);
    assert.deepEqual(pointOnEdge(g, id, 1), g.nodes[e.b]);
  }
  assert.deepEqual(pointOnEdge(g, 0, 0.5), { x: 5, y: 0 });
  for (const [id, e] of graph.edges.entries()) {
    assert.deepEqual(pointOnEdge(graph, id, 0), graph.nodes[e.a]);
    assert.deepEqual(pointOnEdge(graph, id, 1), graph.nodes[e.b]);
  }
});

test('synthetic T-junction connects the two streets', () => {
  const synth: WorldSpec = {
    ...spec,
    population: { pedestrians: { ...spec.population.pedestrians, walkOn: ['road'] } },
  };
  const street = (routeId: string, centerline: { x: number; y: number }[]) => ({
    routeId, kind: 'road', centerline, width: 9, sidewalk: 2,
  });
  const sl: WorldSlice = {
    ...slice,
    streets: [
      street('main', [{ x: 0, y: 0 }, { x: 100, y: 0 }]),
      street('side', [{ x: 50, y: 5 }, { x: 50, y: 100 }]), // starts 5 m from main's centerline
    ],
    isPlayableLand: () => true,
  };
  const g = buildWalkGraph(synth, sl);
  // main: 2 vertices x 2 sides = 4 nodes; side: 4 nodes.
  assert.equal(g.nodes.length, 8);
  const isMain = (i: number) => Math.abs(g.nodes[i]!.y) < 10 && g.nodes[i]!.x % 100 === 0;
  const links = g.edges.filter((e) => e.kind === 'sidewalk' && isMain(e.a) !== isMain(e.b));
  assert.equal(links.length, 2);
  // connectivity: BFS from node 0 reaches every node
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const n = queue.pop()!;
    for (const id of g.adjacency[n]!) {
      const m = otherEnd(g, id, n);
      if (!seen.has(m)) { seen.add(m); queue.push(m); }
    }
  }
  assert.equal(seen.size, g.nodes.length);
  // no junction when the streets are far apart
  const far = buildWalkGraph(synth, { ...sl, streets: [sl.streets[0]!, street('far', [{ x: 50, y: 60 }, { x: 50, y: 100 }])] });
  const farMain = (i: number) => Math.abs(far.nodes[i]!.y) < 10;
  assert.equal(far.edges.filter((e) => e.kind === 'sidewalk' && farMain(e.a) !== farMain(e.b)).length, 0);
});
