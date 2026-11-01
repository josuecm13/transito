import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { districtAt, parseWorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import { clipPolylineToRect, pointInPolygon } from '../src/world/geometry.ts';
import type { Vec2 } from '../src/world/vec.ts';
import { AVENUE_KINDS, generateStreets } from '../src/world/streets/index.ts';
import type { Block } from '../src/world/streets/index.ts';
import { checkPlanarity, pointSegmentDistance, streetComponents } from './streets-check.ts';

const spec = parseWorldSpec(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
const slice = sliceWorld(spec);
const net = generateStreets(spec, slice);
const P = (id: number) => net.graph.nodes[id] as Vec2;
const generated = net.graph.edges.filter((e) => e.cls !== 'frame' && !e.fixed);

test('real area: the generator produced a street network and blocks', () => {
  assert.ok(generated.length > 200, `generated edges: ${generated.length}`);
  assert.ok(net.blocks.filter((b) => b.district === 'costa-del-este').length > 100);
  assert.equal(net.stats.shortEdgesLeft, 0);
});

test('determinism: same seed + spec → deep-equal graph and blocks; another seed differs', () => {
  const again = generateStreets(spec, slice);
  assert.deepEqual(again, net);
  const other = generateStreets(spec, slice, { seed: spec.streetStyles.seed + 1 });
  assert.notDeepEqual(other.graph, net.graph);
});

test('real area: planar (no crossing without a node), no nodes within 1 m, no street edge < 8 m', () => {
  const r = checkPlanarity(net.graph);
  assert.deepEqual(r.crossings, []);
  assert.deepEqual(r.closeNodes, []);
  assert.deepEqual(r.nodeNearEdge, []);
  assert.deepEqual(r.shortEdges, []);
});

test('avenues intact: every route vertex in the active area is on the graph avenue, geometry unchanged', () => {
  for (const route of spec.routes.filter((r) => AVENUE_KINDS.has(r.kind))) {
    const pieces = clipPolylineToRect(route.points, slice.rect);
    const edges = net.graph.edges.filter((e) => e.routeId === route.id);
    const want = pieces.reduce((s, p) => s + p.slice(1).reduce((t, q, i) => t + Math.hypot(q.x - p[i]!.x, q.y - p[i]!.y), 0), 0);
    const got = edges.reduce((s, e) => s + e.length, 0);
    assert.ok(Math.abs(got - want) < 0.5, `${route.id}: avenue length ${got} vs spec ${want}`);
    for (const piece of pieces) {
      for (const p of piece) {
        const d = Math.min(...edges.flatMap((e) => [e.a, e.b]).map((id) => Math.hypot(P(id).x - p.x, P(id).y - p.y)));
        assert.ok(d <= 0.5, `${route.id}: vertex ${p.x},${p.y} is ${d.toFixed(3)} m from the graph avenue`);
      }
    }
    for (const e of edges) {
      assert.equal(e.fixed, true);
      for (const id of [e.a, e.b]) {
        const d = Math.min(...pieces.flatMap((pc) => pc.slice(1).map((q, i) => pointSegmentDistance(P(id), pc[i]!, q).d)));
        assert.ok(d < 1e-6, `${route.id}: avenue node ${id} moved ${d} m off the spec polyline`);
      }
    }
  }
});

test('no floating streets: every street component contains an avenue', () => {
  const fixed = new Set(net.graph.edges.filter((e) => e.fixed).map((e) => e.id));
  for (const comp of streetComponents(net.graph)) {
    assert.ok(comp.some((id) => fixed.has(id)), `component of ${comp.length} edges has no avenue`);
  }
});

test('generated streets stay on playable land, inside their district (nodes + samples every 5 m)', () => {
  for (const e of generated) {
    const a = P(e.a);
    const b = P(e.b);
    const n = Math.max(1, Math.ceil(e.length / 5));
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      assert.ok(slice.isPlayableLand(p), `edge ${e.id} (${e.district}) leaves playable land at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      assert.equal(districtAt(spec, p)?.id, e.district, `edge ${e.id} leaves its district at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
  }
});

const inBlock = (p: Vec2, b: Block) => pointInPolygon(p, b.ring) && !b.holes.some((h) => pointInPolygon(p, h));
const bbox = (b: Block) => {
  const xs = b.ring.map((p) => p.x);
  const ys = b.ring.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

test('blocks do not overlap (bbox prefilter + sample points just inside every ring edge)', () => {
  const boxes = net.blocks.map(bbox);
  const samples = net.blocks.map((b) => {
    const pts: Vec2[] = [b.interior];
    for (let i = 0; i < b.ring.length; i++) {
      const p = b.ring[i]!;
      const q = b.ring[(i + 1) % b.ring.length]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1) continue;
      const m = { x: (p.x + q.x) / 2 - ((q.y - p.y) / len) * 0.05, y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * 0.05 };
      if (inBlock(m, b)) pts.push(m);
    }
    return pts;
  });
  let pairs = 0;
  for (let i = 0; i < net.blocks.length; i++) {
    for (let j = 0; j < net.blocks.length; j++) {
      if (i === j) continue;
      const A = boxes[i]!;
      const B = boxes[j]!;
      if (A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY) continue;
      pairs++;
      for (const p of samples[i]!) assert.ok(!inBlock(p, net.blocks[j]!), `block ${i} overlaps block ${j} at ${p.x},${p.y}`);
    }
  }
  assert.ok(pairs > 100, `checked ${pairs} candidate pairs`);
});

test('blocks tile the playable land: Σ block area = land area of each district (±2%, independent 2 m sampling)', () => {
  for (const id of ['costa-del-este', 'airport', 'tito-corridor']) {
    const blocksArea = net.blocks.filter((b) => b.district === id).reduce((s, b) => s + b.area, 0);
    // Independent estimate: count 2 m cells whose center is playable land in the district.
    const cell = 2;
    let count = 0;
    const r = slice.rect;
    for (let x = r.minX + cell / 2; x < r.maxX; x += cell) {
      for (let y = r.minY + cell / 2; y < r.maxY; y += cell) {
        const p = { x, y };
        if (districtAt(spec, p)?.id === id && slice.isPlayableLand(p)) count++;
      }
    }
    const land = count * cell * cell;
    const rel = Math.abs(blocksArea - land) / land;
    assert.ok(rel <= 0.02, `${id}: blocks ${blocksArea.toFixed(0)} m² vs land ${land} m² (${(rel * 100).toFixed(2)}%)`);
  }
});

test('performance: generateStreets on the real spec in < 700 ms (median of 3)', () => {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    generateStreets(spec, slice);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[1]!;
  console.log(`# generateStreets median ${median.toFixed(0)} ms (runs ${times.map((t) => t.toFixed(0)).join(', ')})`);
  assert.ok(median < 700, `${median} ms`);
});
