import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorldData } from '../src/world/world-data.ts';
import { buildingCorners } from '../src/world/blockout.ts';
import { buildWalkGraph, joinTouchingDeadEnds, nextEdge, otherEnd, pointOnEdge } from '../src/world/walk-graph.ts';
import type { StreetWalkGraph, WalkGraph } from '../src/world/walk-graph.ts';
import type { GraphSnapshot, EdgeClass } from '../src/world/streets/planar-graph.ts';
import { distanceToSegment, pointInPolygon } from '../src/world/geometry.ts';
import { createRng } from '../src/world/rng.ts';
import { distance, lerp } from '../src/world/vec.ts';
import type { Vec2 } from '../src/world/vec.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const data = buildWorldData(yaml);
const { slice, streets, buildings } = data;
const graph = data.walkGraph;
/** The street graph the walk graph was built on (origin ids refer to it). */
const joined = joinTouchingDeadEnds(streets.graph);

// ---------- helpers ----------

/** Component id per node (BFS). */
function components(g: WalkGraph): number[] {
  const comp = new Array<number>(g.nodes.length).fill(-1);
  let c = 0;
  for (let s = 0; s < g.nodes.length; s++) {
    if (comp[s]! >= 0) continue;
    comp[s] = c;
    const stack = [s];
    while (stack.length) {
      const n = stack.pop()!;
      for (const id of g.adjacency[n]!) {
        const m = otherEnd(g, id, n);
        if (comp[m]! < 0) {
          comp[m] = c;
          stack.push(m);
        }
      }
    }
    c++;
  }
  return comp;
}

/** Street components: street nodes joined by walkable street edges (sidewalk > 0 or alley). */
function streetComponents(sg: GraphSnapshot): number[] {
  const parent = sg.nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const e of sg.edges) {
    if (e.cls !== 'frame' && (e.sidewalk > 0 || e.cls === 'alley')) parent[find(e.a)] = find(e.b);
  }
  return sg.nodes.map((_, i) => find(i));
}

/** Every street component maps to exactly one walk component and vice versa. */
function assertConnectedPerStreetComponent(g: StreetWalkGraph, sg: GraphSnapshot): void {
  const comp = components(g);
  const sc = streetComponents(sg);
  const walkOf = new Map<number, Set<number>>();
  const streetOf = new Map<number, Set<number>>();
  g.origin.forEach((o, i) => {
    const s = sc[o]!;
    const w = comp[i]!;
    if (!walkOf.has(s)) walkOf.set(s, new Set());
    walkOf.get(s)!.add(w);
    if (!streetOf.has(w)) streetOf.set(w, new Set());
    streetOf.get(w)!.add(s);
  });
  for (const [s, ws] of walkOf) assert.equal(ws.size, 1, `street component ${s} split into ${ws.size} walk components`);
  for (const [w, ss] of streetOf) assert.equal(ss.size, 1, `walk component ${w} spans ${ss.size} street components`);
}

function streetDegree(sg: GraphSnapshot): number[] {
  const deg = sg.nodes.map(() => 0);
  for (const e of sg.edges) {
    if (e.cls === 'frame') continue;
    deg[e.a]!++;
    deg[e.b]!++;
  }
  return deg;
}

function crossingsByOrigin(g: StreetWalkGraph): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of g.edges) {
    if (e.kind !== 'crossing') continue;
    assert.equal(g.origin[e.a], g.origin[e.b], 'crossing joins nodes of two different street nodes');
    m.set(g.origin[e.a]!, (m.get(g.origin[e.a]!) ?? 0) + 1);
  }
  return m;
}

// ---------- synthetic networks ----------

type Seg = [number, number, EdgeClass, number, number]; // a, b, cls, width, sidewalk
function snapshot(pts: [number, number][], segs: Seg[]): GraphSnapshot {
  return {
    nodes: pts.map(([x, y], id) => ({ id, x, y, pinned: false })),
    edges: segs.map(([a, b, cls, width, sidewalk], id) => ({
      id, a, b, cls, width, sidewalk, fixed: false,
      length: Math.hypot(pts[a]![0] - pts[b]![0], pts[a]![1] - pts[b]![1]),
    })),
  };
}
const LOCAL = ['local', 7, 2] as const;
const count = (g: WalkGraph, kind: string) => g.edges.filter((e) => e.kind === kind).length;

test('synthetic +: 4 miter corners, 4 dead-end wraps, a crossing on every arm, connected', () => {
  const sg = snapshot([[0, 0], [100, 0], [0, 100], [-100, 0], [0, -100]], [
    [0, 1, ...LOCAL], [0, 2, ...LOCAL], [0, 3, ...LOCAL], [0, 4, ...LOCAL],
  ]);
  const g = buildWalkGraph(sg);
  // 4 corners + 4 caps × 5 nodes.
  assert.equal(g.nodes.length, 24);
  // 8 sidewalks along the arms + 4 caps × 4 + 4 crossings.
  assert.equal(count(g, 'sidewalk'), 24);
  assert.equal(count(g, 'crossing'), 4);
  assert.equal(g.edges.length, 28);
  // Corners sit on both offset lines (o = 3.5 + 1 = 4.5).
  const corners = g.nodes.filter((p) => Math.abs(p.x) < 10 && Math.abs(p.y) < 10);
  assert.equal(corners.length, 4);
  for (const p of corners) assert.ok(Math.abs(Math.abs(p.x) - 4.5) < 1e-9 && Math.abs(Math.abs(p.y) - 4.5) < 1e-9);
  // Each crossing spans one arm: both ends on the same side of the center along that arm.
  for (const e of g.edges.filter((x) => x.kind === 'crossing')) assert.ok(Math.abs(e.length - 9) < 1e-9);
  assert.equal(crossingsByOrigin(g).get(0), 4);
  assertConnectedPerStreetComponent(g, sg);
  assert.equal(new Set(components(g)).size, 1);
});

test('synthetic T with dead ends: straight side merges, 3 crossings, connected', () => {
  const sg = snapshot([[0, 0], [-100, 0], [100, 0], [0, 100]], [[1, 0, ...LOCAL], [0, 2, ...LOCAL], [0, 3, ...LOCAL]]);
  const g = buildWalkGraph(sg);
  assert.equal(g.nodes.length, 3 + 3 * 5);
  assert.equal(count(g, 'sidewalk'), 6 + 3 * 4);
  assert.equal(count(g, 'crossing'), 3);
  assert.ok(g.nodes.some((p) => Math.abs(p.x) < 1e-9 && Math.abs(p.y + 4.5) < 1e-9), 'straight side corner at (0,-4.5)');
  assertConnectedPerStreetComponent(g, sg);
  assert.equal(new Set(components(g)).size, 1);
});

test('synthetic alley off a local: walked on its centerline from the sidewalk line, no crossing on it', () => {
  const sg = snapshot([[0, 0], [-100, 0], [100, 0], [0, 60]], [
    [1, 0, ...LOCAL], [0, 2, ...LOCAL], [0, 3, 'alley', 3.5, 0],
  ]);
  const g = buildWalkGraph(sg);
  // Both corners beside the alley meet on its centerline at (0, 4.5); straight side (0,-4.5);
  // alley far end (0, 60); 2 caps × 5.
  assert.equal(g.nodes.length, 2 + 1 + 10);
  assert.ok(g.nodes.some((p) => Math.abs(p.x) < 1e-9 && Math.abs(p.y - 4.5) < 1e-9), 'alley mouth on the sidewalk line');
  assert.ok(g.nodes.some((p) => p.x === 0 && p.y === 60));
  assert.equal(count(g, 'alley'), 1);
  assert.equal(count(g, 'sidewalk'), 4 + 8);
  // One crossing of the local at the mouth; none across the alley.
  assert.equal(count(g, 'crossing'), 1);
  assert.equal(new Set(components(g)).size, 1);
});

test('synthetic straight local into an alley: the arc keeps off the local carriageway end', () => {
  const sg = snapshot([[0, 0], [-100, 0], [60, 0]], [[1, 0, ...LOCAL], [0, 2, 'alley', 3.5, 0]]);
  const g = buildWalkGraph(sg);
  for (const e of g.edges) {
    const n = 20;
    for (let k = 0; k <= n; k++) {
      const p = lerp(g.nodes[e.a]!, g.nodes[e.b]!, k / n);
      assert.ok(distanceToSegment(p, { x: -100, y: 0 }, { x: 0, y: 0 }) >= 3.5 - 1e-9, `${e.kind} at ${p.x},${p.y}`);
    }
  }
  assert.equal(new Set(components(g)).size, 1);
});

test('synthetic dead end stopping inside a passing sidewalk is joined: a T with its crossings', () => {
  // Main local along y = 0; a stub local comes from the north and stops 5 m from it, unjoined.
  const sg = snapshot([[-100, 0], [100, 0], [0, 5], [0, 100], [50, 100]], [
    [0, 1, ...LOCAL], [2, 3, ...LOCAL], [3, 4, ...LOCAL],
  ]);
  const joinedSg = joinTouchingDeadEnds(sg);
  // The stub now ends at a new node (id 5) splitting the main street at (0, 0).
  assert.equal(joinedSg.nodes.length, 6);
  assert.deepEqual([joinedSg.nodes[5]!.x, joinedSg.nodes[5]!.y], [0, 0]);
  assert.equal(joinedSg.edges.filter((e) => e.a === 5 || e.b === 5).length, 3);
  const g = buildWalkGraph(sg);
  assert.equal(crossingsByOrigin(g).get(5), 3, 'T: a crossing per arm');
  assertConnectedPerStreetComponent(g, joinedSg);
  assert.equal(new Set(components(g)).size, 1);
  // No walk node on a (rendered, unjoined) carriageway.
  const on = carriagewayTest(sg);
  for (const p of g.nodes) assert.ok(!on(p), `node ${p.x},${p.y}`);
  // A dead end far from any street is left alone.
  const far = snapshot([[-100, 0], [100, 0], [0, 30], [0, 100]], [[0, 1, ...LOCAL], [2, 3, ...LOCAL]]);
  assert.deepEqual(joinTouchingDeadEnds(far), far);
});

test('synthetic local across a highway (no sidewalk): crossings over the highway keep both halves connected', () => {
  const sg = snapshot([[0, 0], [-100, 0], [100, 0], [0, 100], [0, -100]], [
    [1, 0, 'avenue', 24, 0], [0, 2, 'avenue', 24, 0], [0, 3, ...LOCAL], [0, 4, ...LOCAL],
  ]);
  const g = buildWalkGraph(sg);
  assert.equal(count(g, 'crossing'), 4);
  // No walkway along the highway: every node is near the local (|x| <= 4.5).
  for (const p of g.nodes) assert.ok(Math.abs(p.x) <= 4.5 + 1e-9, `node ${p.x},${p.y}`);
  // No node on the highway carriageway (|y| < 12) except as a crossing end... corners are outside it.
  for (const p of g.nodes) assert.ok(Math.abs(p.y) >= 12, `node on highway ${p.x},${p.y}`);
  assert.equal(new Set(components(g)).size, 1);
});

test('walk_on: a street class not listed gets no walkway (alley, local)', () => {
  const sg = snapshot([[0, 0], [-100, 0], [100, 0], [0, 60]], [
    [1, 0, ...LOCAL], [0, 2, ...LOCAL], [0, 3, 'alley', 3.5, 0],
  ]);
  assert.equal(count(buildWalkGraph(sg, undefined, ['avenue', 'collector', 'local', 'alley']), 'alley'), 1);
  const noAlley = buildWalkGraph(sg, undefined, ['avenue', 'collector', 'local']);
  assert.equal(count(noAlley, 'alley'), 0);
  // Nothing walks up the alley: every node stays by the local (|y| <= 4.5).
  for (const p of noAlley.nodes) assert.ok(Math.abs(p.y) <= 4.5 + 1e-9, `node ${p.x},${p.y}`);
  assert.ok(count(noAlley, 'sidewalk') > 0);
  // Locals not listed: no sidewalk along them either.
  assert.equal(count(buildWalkGraph(sg, undefined, ['alley']), 'sidewalk'), 0);
});

test('walk_on: the real area uses world.yaml walk_on; dropping alley removes every alley walk edge', () => {
  assert.deepEqual(data.spec.population.pedestrians.walkOn, ['avenue', 'collector', 'local', 'alley']);
  assert.ok(count(graph, 'alley') > 0, 'the real area has alley walkways');
  const noAlley = buildWalkGraph(streets.graph, slice.isPlayableLand, ['avenue', 'collector', 'local']);
  assert.equal(count(noAlley, 'alley'), 0);
  // buildWorldData passes world.yaml's walk_on through.
  const noAlleyYaml = yaml.replace(/^( {4}walk_on:) \[avenue, collector, local, alley\]$/m, '$1 [avenue, collector, local]');
  assert.notEqual(noAlleyYaml, yaml);
  assert.equal(count(buildWorldData(noAlleyYaml).walkGraph, 'alley'), 0);
});

test('frame edges are ignored', () => {
  const sg = snapshot([[0, 0], [100, 0], [100, 100]], [[0, 1, ...LOCAL], [1, 2, 'frame', 0, 0]]);
  const g = buildWalkGraph(sg);
  assert.ok(g.nodes.every((p) => p.x <= 100 + 4.5 + 1e-9 && Math.abs(p.y) <= 4.5 + 1e-9));
});

// ---------- real area ----------

test('real area: stats', () => {
  const crossings = count(graph, 'crossing');
  console.log(
    `walk graph nodes=${graph.nodes.length} edges=${graph.edges.length} crossings=${crossings} ` +
      `alley=${count(graph, 'alley')} components=${new Set(components(graph)).size}`,
  );
  assert.ok(graph.nodes.length > 1000);
  assert.ok(crossings > 500);
});

test('real area: nodes on playable land, adjacency consistent, lengths exact', () => {
  graph.nodes.forEach((p, i) => {
    assert.ok(graph.adjacency[i]!.length >= 1, `node ${i}`);
    assert.ok(slice.isPlayableLand(p), `node ${i} at ${p.x},${p.y}`);
  });
  graph.edges.forEach((e, id) => {
    assert.ok(graph.adjacency[e.a]!.includes(id) && graph.adjacency[e.b]!.includes(id));
    assert.ok(Math.abs(e.length - distance(graph.nodes[e.a]!, graph.nodes[e.b]!)) < 1e-9);
    assert.ok(e.length > 0);
  });
});

test('real area: connected within each street component', () => {
  assertConnectedPerStreetComponent(graph, joined);
});

test('real area: every crossing is at an intersection, every interior intersection has its crossings', () => {
  const deg = streetDegree(joined);
  const byOrigin = crossingsByOrigin(graph);
  assert.ok(byOrigin.size > 0);
  const incident = (o: number) => joined.edges.filter((e) => e.cls !== 'frame' && (e.a === o || e.b === o));
  for (const e of graph.edges) {
    if (e.kind !== 'crossing') continue;
    const o = graph.origin[e.a]!;
    const sn = joined.nodes[o]!;
    for (const p of [graph.nodes[e.a]!, graph.nodes[e.b]!]) assert.ok(distance(p, sn) < 30, `crossing end ${distance(p, sn)} m from its node`);
    if (deg[o]! >= 3) continue;
    // Otherwise only a sidewalk street running end to end into a street without sidewalk.
    const arms = incident(o);
    assert.ok(deg[o] === 2 && arms.some((a) => a.sidewalk > 0) && arms.some((a) => a.sidewalk === 0 && a.cls !== 'alley'), `crossing at street node ${o} of degree ${deg[o]}`);
  }
  // Interior intersections (degree >= 3 with a sidewalk arm, 40 m inside the active area): at
  // least one crossing, and the intersection's own walk nodes (its corners) are all joined by its
  // own edges (crossings, arcs, alley mouths): every arm can be crossed there.
  const r = slice.rect;
  const sidewalkArms = joined.nodes.map(() => 0);
  for (const e of joined.edges) {
    if (e.cls === 'frame' || e.sidewalk <= 0) continue;
    sidewalkArms[e.a]!++;
    sidewalkArms[e.b]!++;
  }
  const localNodes = new Map<number, number[]>();
  graph.origin.forEach((o, i) => {
    if (!localNodes.has(o)) localNodes.set(o, []);
    localNodes.get(o)!.push(i);
  });
  const parent = graph.nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const e of graph.edges) if (graph.origin[e.a] === graph.origin[e.b]) parent[find(e.a)] = find(e.b);
  let checked = 0;
  for (const n of joined.nodes) {
    if (deg[n.id]! < 3 || sidewalkArms[n.id]! === 0) continue;
    if (n.x < r.minX + 40 || n.x > r.maxX - 40 || n.y < r.minY + 40 || n.y > r.maxY - 40) continue;
    if (!slice.isPlayableLand(n)) continue;
    checked++;
    assert.ok((byOrigin.get(n.id) ?? 0) >= 1, `intersection ${n.id} has no crossing`);
    const roots = new Set((localNodes.get(n.id) ?? []).map(find));
    assert.equal(roots.size, 1, `intersection ${n.id}: its corners form ${roots.size} groups (an arm without crossing)`);
  }
  assert.ok(checked > 300, `checked ${checked}`);
});

/** Uniform grid over boxes for brute-force-with-prefilter checks. */
function grid<T>(items: T[], box: (t: T) => [number, number, number, number], cell = 40) {
  const cells = new Map<string, number[]>();
  items.forEach((t, i) => {
    const [x0, y0, x1, y1] = box(t);
    for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) {
      for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) {
        const k = `${x},${y}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k)!.push(i);
      }
    }
  });
  return (p: Vec2): number[] => cells.get(`${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`) ?? [];
}

test('real area: no walk node (and no sidewalk sample point) inside a building footprint', () => {
  const quads = buildings.map((b) => buildingCorners(b));
  const bbox = (q: Vec2[]): [number, number, number, number] => [
    Math.min(...q.map((p) => p.x)), Math.min(...q.map((p) => p.y)), Math.max(...q.map((p) => p.x)), Math.max(...q.map((p) => p.y)),
  ];
  const boxes = quads.map(bbox);
  const near = grid(quads, bbox);
  const inside = (p: Vec2): number => {
    for (const i of near(p)) {
      const [x0, y0, x1, y1] = boxes[i]!;
      if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
      if (pointInPolygon(p, quads[i]!)) return i;
    }
    return -1;
  };
  assert.ok(quads.length > 1000);
  graph.nodes.forEach((p, i) => assert.equal(inside(p), -1, `walk node ${i} at ${p.x},${p.y} inside a building`));
  for (const e of graph.edges) {
    if (e.kind === 'crossing') continue;
    const steps = Math.max(1, Math.ceil(e.length / 1));
    for (let k = 1; k < steps; k++) {
      const p = lerp(graph.nodes[e.a]!, graph.nodes[e.b]!, k / steps);
      assert.equal(inside(p), -1, `${e.kind} edge point ${p.x},${p.y} inside a building`);
    }
  }
});

/**
 * Carriageways of the generated (rendered) network, not alleys: a band of half width width/2 per
 * edge, rounded at nodes where the street continues (junction fill) and flat at dead ends, like the
 * ribbon renderer's flat ends.
 */
function carriagewayTest(sg: GraphSnapshot): (p: Vec2) => boolean {
  const deg = streetDegree(sg);
  const segs = sg.edges
    .filter((e) => e.cls !== 'frame' && e.cls !== 'alley')
    .map((e) => ({ a: sg.nodes[e.a]!, b: sg.nodes[e.b]!, half: e.width / 2, capA: deg[e.a]! >= 2, capB: deg[e.b]! >= 2 }));
  const pad = 15;
  const near = grid(segs, (s) => [Math.min(s.a.x, s.b.x) - pad, Math.min(s.a.y, s.b.y) - pad, Math.max(s.a.x, s.b.x) + pad, Math.max(s.a.y, s.b.y) + pad]);
  return (p) =>
    near(p).some((i) => {
      const s = segs[i]!;
      const t = ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / distance(s.a, s.b) ** 2;
      if ((t < 0 && !s.capA) || (t > 1 && !s.capB)) return false;
      return distanceToSegment(p, s.a, s.b) < s.half - 1e-6;
    });
}

test('real area: sidewalk and alley walkways never run on a carriageway (only crossings do)', () => {
  const onCarriageway = carriagewayTest(streets.graph);
  graph.nodes.forEach((p, i) => assert.ok(!onCarriageway(p), `walk node ${i} at ${p.x},${p.y} on a carriageway`));
  for (const e of graph.edges) {
    if (e.kind === 'crossing') continue;
    const steps = Math.max(1, Math.ceil(e.length / 0.5));
    for (let k = 1; k < steps; k++) {
      const p = lerp(graph.nodes[e.a]!, graph.nodes[e.b]!, k / steps);
      assert.ok(!onCarriageway(p), `${e.kind} edge point ${p.x},${p.y} on a carriageway`);
    }
  }
});

test('real area: deterministic', () => {
  assert.deepEqual(buildWalkGraph(streets.graph, slice.isPlayableLand, data.spec.population.pedestrians.walkOn), graph);
  // Default walkOn (every class) = world.yaml's current list.
  assert.deepEqual(buildWalkGraph(streets.graph, slice.isPlayableLand), graph);
});

// ---------- sim helpers ----------

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

test('otherEnd and pointOnEdge (synthetic and real graph)', () => {
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

test('real area: a random walk with nextEdge visits many edges and never leaves the graph', () => {
  const rng = createRng(11);
  let edge = 0;
  let node = graph.edges[0]!.b;
  const visited = new Set<number>([edge]);
  for (let i = 0; i < 20000; i++) {
    const next = nextEdge(graph, edge, node, rng);
    assert.ok(graph.adjacency[node]!.includes(next));
    node = otherEnd(graph, next, node);
    edge = next;
    visited.add(edge);
  }
  assert.ok(visited.size > 500, `visited ${visited.size}`);
});
