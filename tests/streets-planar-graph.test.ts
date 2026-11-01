import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EdgeProps } from '../src/world/streets/planar-graph.ts';
import { PlanarGraph } from '../src/world/streets/planar-graph.ts';
import { createRng } from '../src/world/rng.ts';
import { checkPlanarity, pointSegmentDistance } from './streets-check.ts';

const local: EdgeProps = { cls: 'local', width: 7, sidewalk: 2, fixed: false };
const avenue: EdgeProps = { cls: 'avenue', width: 14, sidewalk: 3, fixed: true, routeId: 'av' };
const v = (x: number, y: number) => ({ x, y });

const assertPlanar = (g: PlanarGraph, msg = '') => {
  const r = checkPlanarity(g.snapshot());
  assert.deepEqual(r.crossings, [], `${msg} crossings`);
  assert.deepEqual(r.closeNodes, [], `${msg} close nodes`);
  assert.deepEqual(r.nodeNearEdge, [], `${msg} node near edge`);
  return r;
};

test('X crossing splits both edges at one shared node', () => {
  const g = new PlanarGraph();
  g.addSegment(v(0, 0), v(100, 0), local);
  g.addSegment(v(50, -50), v(50, 50), local);
  const s = g.snapshot();
  assert.equal(s.nodes.length, 5);
  assert.equal(s.edges.length, 4);
  const mid = s.nodes.find((n) => Math.abs(n.x - 50) < 1e-9 && Math.abs(n.y) < 1e-9);
  assert.ok(mid, 'node at the crossing');
  assert.equal(s.edges.filter((e) => e.a === mid.id || e.b === mid.id).length, 4);
  assertPlanar(g);
});

test('endpoint within snap of an edge makes a T (edge split, node exactly on it)', () => {
  const g = new PlanarGraph();
  g.addSegment(v(0, 0), v(100, 0), local);
  g.addSegment(v(40, 60), v(40, 0.6), local);
  const s = g.snapshot();
  assert.equal(s.nodes.length, 4);
  assert.equal(s.edges.length, 3);
  assert.ok(s.nodes.some((n) => n.x === 40 && n.y === 0), 'T node projected onto the edge');
  assertPlanar(g);
});

test('endpoints within snap merge into one node; duplicate edges merge', () => {
  const g = new PlanarGraph();
  g.addSegment(v(0, 0), v(50, 0), local);
  g.addSegment(v(50.6, 0.5), v(50, 60), local);
  g.addSegment(v(0.3, -0.4), v(49.8, 0.2), { ...local, cls: 'collector', width: 10 });
  const s = g.snapshot();
  assert.equal(s.nodes.length, 3);
  assert.equal(s.edges.length, 2);
  const e = s.edges.find((x) => x.length < 51)!;
  assert.equal(e.cls, 'collector', 'merged edge keeps the higher class');
  assertPlanar(g);
});

test('colinear overlap within snap collapses into one chain of nodes', () => {
  const g = new PlanarGraph();
  g.addSegment(v(0, 0), v(100, 0), local);
  g.addSegment(v(50, 0.3), v(150, 0.3), local);
  const s = g.snapshot();
  assert.equal(s.nodes.length, 4);
  assert.equal(s.edges.length, 3);
  const total = s.edges.reduce((t, e) => t + e.length, 0);
  assert.ok(Math.abs(total - 150) < 0.5, `total ${total}`);
  assertPlanar(g);
});

test('near-parallel segments that cross at a shallow angle get a shared node', () => {
  const g = new PlanarGraph();
  g.addSegment(v(0, 0), v(200, 0), local);
  g.addSegment(v(0, -3), v(200, 3), local);
  assertPlanar(g);
  const s = g.snapshot();
  assert.ok(s.nodes.some((n) => Math.abs(n.x - 100) < 1.5 && Math.abs(n.y) < 1.5));
});

test('crossing closer than minLength to an endpoint of the crossed street reroutes the new street through it', () => {
  const g = new PlanarGraph();
  g.addSegment(v(0, 0), v(100, 0), local);
  g.addSegment(v(5, -50), v(5, 50), local);
  const s = g.snapshot();
  assert.equal(s.nodes.length, 4, 'no extra node 5 m from the corner');
  const r = assertPlanar(g);
  assert.deepEqual(r.shortEdges, []);
});

test('fixed avenue is split exactly on its line and never rerouted', () => {
  const g = new PlanarGraph();
  g.addPolyline([v(0, 0), v(100, 37), v(220, 40)], avenue);
  for (let x = 10; x < 220; x += 23) g.addSegment(v(x, -40), v(x + 3, 90), local);
  const s = g.snapshot();
  const line = [v(0, 0), v(100, 37), v(220, 40)];
  for (const e of s.edges.filter((x) => x.fixed)) {
    for (const id of [e.a, e.b]) {
      const n = s.nodes[id]!;
      const d = Math.min(pointSegmentDistance(n, line[0]!, line[1]!).d, pointSegmentDistance(n, line[1]!, line[2]!).d);
      assert.ok(d < 1e-6, `avenue node ${id} off the line by ${d}`);
    }
  }
  const avLen = s.edges.filter((e) => e.fixed).reduce((t, e) => t + e.length, 0);
  assert.ok(Math.abs(avLen - (Math.hypot(100, 37) + Math.hypot(120, 3))) < 1e-6);
  assert.ok(s.nodes.filter((n) => n.pinned).length === 3, 'spec vertices pinned');
  assertPlanar(g);
});

test('an avenue inserted after a street splits it exactly instead of bending towards its endpoint', () => {
  const g = new PlanarGraph();
  g.addSegment(v(50, -4), v(50, 80), local); // crossing point is 4 m from this street's end
  g.addPolyline([v(0, 0), v(100, 0)], avenue);
  const s = g.snapshot();
  for (const e of s.edges.filter((x) => x.fixed)) for (const id of [e.a, e.b]) assert.equal(s.nodes[id]!.y, 0, 'avenue stays on y = 0');
  assert.ok(Math.abs(s.edges.filter((e) => e.fixed).reduce((t, e) => t + e.length, 0) - 100) < 1e-9);
  assertPlanar(g);
  g.collapseShortEdges();
  const s2 = g.snapshot();
  for (const e of s2.edges.filter((x) => x.fixed)) for (const id of [e.a, e.b]) assert.equal(s2.nodes[id]!.y, 0);
  assert.deepEqual(checkPlanarity(s2).shortEdges, [], 'the 4 m stub is collapsed into the avenue node');
});

test('collapseShortEdges merges two crossings 5 m apart on an avenue without moving it', () => {
  const g = new PlanarGraph();
  g.addPolyline([v(0, 0), v(200, 0)], avenue);
  g.addSegment(v(100, -60), v(100, 60), local);
  g.addSegment(v(105, 0.5), v(105, 60), local); // T snapped onto the avenue 5 m from the crossing
  assert.ok(g.snapshot().edges.some((e) => e.fixed && e.length < 8), 'precondition: a 5 m avenue edge');
  assert.equal(g.collapseShortEdges(), 0);
  const s = g.snapshot();
  for (const e of s.edges.filter((x) => x.fixed)) for (const id of [e.a, e.b]) assert.equal(s.nodes[id]!.y, 0);
  assert.ok(Math.abs(s.edges.filter((e) => e.fixed).reduce((t, e) => t + e.length, 0) - 200) < 1e-9);
  const r = assertPlanar(g);
  assert.deepEqual(r.shortEdges, []);
});

test('pruneDangling removes short dead-end chains only; removeFloatingStreets drops streets with no avenue', () => {
  const g = new PlanarGraph();
  g.addPolyline([v(0, 0), v(300, 0)], avenue);
  g.addSegment(v(100, 0), v(100, 10), local); // 10 m stub
  g.addSegment(v(200, 0), v(200, 60), local); // 60 m cul-de-sac
  g.addSegment(v(50, 100), v(250, 100), local); // floating
  assert.equal(g.pruneDangling(25), 1);
  assert.equal(g.removeFloatingStreets(), 1);
  const s = g.snapshot();
  assert.equal(s.edges.filter((e) => !e.fixed).length, 1);
  assert.equal(s.edges.find((e) => !e.fixed)!.length, 60);
});

/** Random segments, a third of them near-parallel overlaps of earlier ones, plus an avenue. */
function randomGraph(seed: number, count: number): { g: PlanarGraph; segs: [{ x: number; y: number }, { x: number; y: number }][] } {
  const rng = createRng(seed);
  const g = new PlanarGraph();
  g.addPolyline([v(0, 200), v(150, 230), v(400, 180)], avenue);
  const segs: [{ x: number; y: number }, { x: number; y: number }][] = [];
  for (let i = 0; i < count; i++) {
    const a = v(rng.range(0, 400), rng.range(0, 400));
    const ang = rng.range(0, Math.PI);
    let b = v(a.x + Math.cos(ang) * rng.range(5, 160), a.y + Math.sin(ang) * rng.range(5, 160));
    if (i > 10 && i % 3 === 0) {
      const [p, q] = segs[rng.int(0, segs.length - 1)]!;
      const off = rng.range(-2, 2);
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const nx = -(q.y - p.y) / len;
      const ny = (q.x - p.x) / len;
      const t0 = rng.range(-0.3, 0.7);
      const t1 = t0 + rng.range(0.05, 0.8);
      const at = (t: number) => v(p.x + (q.x - p.x) * t + nx * off, p.y + (q.y - p.y) * t + ny * off * 1.01);
      segs.push([at(t0), at(t1)]);
    } else {
      if (i % 5 === 0 && segs.length > 0) b = segs[rng.int(0, segs.length - 1)]![rng.int(0, 1)]!; // shared endpoint
      segs.push([a, b]);
    }
    const sg = segs[segs.length - 1]!;
    g.addSegment(sg[0], sg[1], local);
  }
  return { g, segs };
}

// Seeds 21 and 29 produce fans of near-parallel edges that only repair() resolves.
for (const seed of [7, 21, 29]) {
  test(`brute force (seed ${seed}): 300 random segments with near-parallel overlaps stay planar, avenue intact`, () => {
    const { g, segs } = randomGraph(seed, 300);
    assert.deepEqual(checkPlanarity(g.snapshot()).crossings, [], 'insertion never leaves a crossing');
    g.repair();
    assertPlanar(g, 'after repair');
    const s0 = g.snapshot();
    for (const [a, b] of segs) {
      const m = v((a.x + b.x) / 2, (a.y + b.y) / 2);
      const d = Math.min(...s0.edges.map((e) => pointSegmentDistance(m, s0.nodes[e.a]!, s0.nodes[e.b]!).d));
      assert.ok(d < 8, `segment midpoint ${m.x.toFixed(1)},${m.y.toFixed(1)} is ${d.toFixed(2)} m from the graph`);
    }
    assert.equal(g.collapseShortEdges(), 0, 'no short street left');
    const r = assertPlanar(g, 'after collapse');
    assert.deepEqual(r.shortEdges, []);
    const avLen = g.snapshot().edges.filter((e) => e.fixed).reduce((t, e) => t + e.length, 0);
    assert.ok(Math.abs(avLen - (Math.hypot(150, 30) + Math.hypot(250, 50))) < 1e-6, `avenue length ${avLen}`);
  });
}
