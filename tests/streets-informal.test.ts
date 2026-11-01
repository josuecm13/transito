/**
 * Organic growth for informal districts (issue #7, S4): tito-corridor on the real active area.
 *
 * Realism is measured against La Carpio (specs/map/street-metrics.yaml, band.default +
 * band.overrides) with alleys EXCLUDED (`excludeClasses: ['alley']`, blocks recomputed without
 * them): the engine that froze La Carpio does not import footway / path / steps, so its numbers
 * contain no alleys. Densities use the district's grid cells inside the active area as the
 * denominator (`area: 'cells'`), the analogue of the reference's bbox km², as in S3's realism test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { WorldSpec } from '../src/world/spec.ts';
import { districtAt, parseWorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import { clipPolylineToRect, pointInPolygon } from '../src/world/geometry.ts';
import type { StreetMetrics } from '../src/world/street-metrics.ts';
import type { Vec2 } from '../src/world/vec.ts';
import type { Block, GenerateOptions, StreetNetwork } from '../src/world/streets/index.ts';
import {
  AVENUE_KINDS,
  buildBlocks,
  generateStreets,
  measureDistrict,
  PlanarGraph,
  withoutClasses,
} from '../src/world/streets/index.ts';
import type { MetricsFile } from './streets-check.ts';
import { bandViolations, checkPlanarity, pointSegmentDistance, streetComponents } from './streets-check.ts';

const ID = 'tito-corridor';
const root = join(import.meta.dirname, '..');
const spec = parseWorldSpec(readFileSync(join(root, 'specs/map/world.yaml'), 'utf8'));
const metricsFile = load(readFileSync(join(root, 'specs/map/street-metrics.yaml'), 'utf8')) as MetricsFile;
const slice = sliceWorld(spec);

const tCold = performance.now();
const net = generateStreets(spec, slice);
const coldMs = performance.now() - tCold;

const P = (id: number) => net.graph.nodes[id] as Vec2;
const informal = net.graph.edges.filter((e) => e.district === ID);

const fmt = (x: StreetMetrics) =>
  `blocks=${x.blocks_measured} median=${x.block_area_median_m2.toFixed(0)} p90=${x.block_area_p90_m2.toFixed(0)} ` +
  `dead=${(x.dead_end_share * 100).toFixed(1)}% T=${(x.t_share * 100).toFixed(1)}% X=${(x.x_share * 100).toFixed(1)}% ` +
  `int/km2=${x.intersections_per_km2.toFixed(1)} km/km2=${x.street_km_per_km2.toFixed(2)} seg=${x.mean_segment_m.toFixed(1)}`;

/** Corridor metrics, alleys excluded, per km² of grid cells (the realism measure). */
const corridorMetrics = (n: StreetNetwork, s: WorldSpec, area: 'cells' | 'land' = 'cells') =>
  measureDistrict(n, s, slice.rect, ID, { area, excludeClasses: ['alley'], isInside: slice.isPlayableLand });

/** First 5 m sample of an informal street that leaves playable land or tito-corridor. */
function leavesDistrict(n: StreetNetwork): string | undefined {
  for (const e of n.graph.edges) {
    if (e.district !== ID) continue;
    const a = n.graph.nodes[e.a] as Vec2;
    const b = n.graph.nodes[e.b] as Vec2;
    const k = Math.max(1, Math.ceil(e.length / 5));
    for (let i = 0; i <= k; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / k, y: a.y + ((b.y - a.y) * i) / k };
      if (!slice.isPlayableLand(p)) return `edge ${e.id} (${e.cls}) leaves playable land at ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      const d = districtAt(spec, p)?.id;
      if (d !== ID) return `edge ${e.id} (${e.cls}) enters ${d} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
  }
  return undefined;
}

/** La Carpio band violations of the corridor for a spec / options. */
function corridorViolations(s: WorldSpec, opts: GenerateOptions = {}, label = '', onNet?: (n: StreetNetwork) => void): string[] {
  const n = generateStreets(s, sliceWorld(s), opts);
  onNet?.(n);
  const m = corridorMetrics(n, s);
  const refs = s.streetStyles.districts[ID]!.reference;
  const v = refs.flatMap((r) => bandViolations(m, r.name, metricsFile).map((x) => `${r.name}: ${x}`));
  if (label) console.log(`# ${label}: ${fmt(m)} ${v.length === 0 ? 'IN' : `OUT (${v.length})`}`);
  return v;
}

test('organic growth produced streets and alleys in tito-corridor', () => {
  const locals = informal.filter((e) => e.cls === 'local');
  const alleys = informal.filter((e) => e.cls === 'alley');
  assert.ok(locals.length > 300, `local edges: ${locals.length}`);
  assert.ok(alleys.length > 10, `alley edges: ${alleys.length}`);
  assert.ok(net.blocks.filter((b) => b.district === ID).length > 150);
  assert.equal(net.stats.shortEdgesLeft, 0);
});

test('determinism: same seed + spec → deep-equal network; another seed → different corridor', () => {
  assert.deepEqual(generateStreets(spec, slice), net);
  const other = generateStreets(spec, slice, { seed: spec.streetStyles.seed + 1 });
  const mine = (n: StreetNetwork) => n.graph.edges.filter((e) => e.district === ID).map((e) => [n.graph.nodes[e.a], n.graph.nodes[e.b]]);
  assert.notDeepEqual(mine(other), mine(net));
});

test('planar on the real area with growth on: no crossing without a node, no nodes within 1 m, no non-alley edge < 8 m', () => {
  const r = checkPlanarity(net.graph);
  assert.deepEqual(r.crossings, []);
  assert.deepEqual(r.closeNodes, []);
  assert.deepEqual(r.nodeNearEdge, []);
  assert.deepEqual(r.shortEdges, []);
});

test('no floating streets: every street component (alleys included) contains an avenue', () => {
  const fixed = new Set(net.graph.edges.filter((e) => e.fixed).map((e) => e.id));
  const comps = streetComponents(net.graph);
  const alleyIds = new Set(informal.filter((e) => e.cls === 'alley').map((e) => e.id));
  let alleysSeen = 0;
  for (const comp of comps) {
    assert.ok(comp.some((id) => fixed.has(id)), `component of ${comp.length} edges has no avenue`);
    alleysSeen += comp.filter((id) => alleyIds.has(id)).length;
  }
  assert.equal(alleysSeen, alleyIds.size);
});

test('avenues intact with growth on: route geometry and length unchanged', () => {
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

test('informal streets stay on playable land and inside tito-corridor (nodes + samples every 5 m)', () => {
  assert.ok(informal.length > 0);
  assert.equal(leavesDistrict(net), undefined);
});

const inBlock = (p: Vec2, b: Block) => pointInPolygon(p, b.ring) && !b.holes.some((h) => pointInPolygon(p, h));

test('corridor blocks do not overlap any block (sample points just inside every ring edge)', () => {
  const box = (b: Block) => {
    const xs = b.ring.map((p) => p.x);
    const ys = b.ring.map((p) => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  const boxes = net.blocks.map(box);
  let pairs = 0;
  net.blocks.forEach((b, i) => {
    if (b.district !== ID) return;
    const pts: Vec2[] = [b.interior];
    for (let k = 0; k < b.ring.length; k++) {
      const p = b.ring[k]!;
      const q = b.ring[(k + 1) % b.ring.length]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1) continue;
      const m = { x: (p.x + q.x) / 2 - ((q.y - p.y) / len) * 0.05, y: (p.y + q.y) / 2 + ((q.x - p.x) / len) * 0.05 };
      if (inBlock(m, b)) pts.push(m);
    }
    const A = boxes[i]!;
    net.blocks.forEach((o, j) => {
      if (i === j) return;
      const B = boxes[j]!;
      if (A.maxX < B.minX || B.maxX < A.minX || A.maxY < B.minY || B.maxY < A.minY) return;
      pairs++;
      for (const p of pts) assert.ok(!inBlock(p, o), `block ${i} overlaps block ${j} at ${p.x},${p.y}`);
    });
  });
  assert.ok(pairs > 500, `checked ${pairs} candidate pairs`);
});

test('corridor blocks tile its playable land: Σ block area = land area (±2%, independent 2 m sampling)', () => {
  const blocksArea = net.blocks.filter((b) => b.district === ID).reduce((s, b) => s + b.area, 0);
  const cell = 2;
  let count = 0;
  const r = slice.rect;
  for (let x = r.minX + cell / 2; x < r.maxX; x += cell) {
    for (let y = r.minY + cell / 2; y < r.maxY; y += cell) {
      const p = { x, y };
      if (districtAt(spec, p)?.id === ID && slice.isPlayableLand(p)) count++;
    }
  }
  const land = count * cell * cell;
  const rel = Math.abs(blocksArea - land) / land;
  console.log(`# ${ID}: blocks ${blocksArea.toFixed(0)} m² vs land ${land} m² (${(rel * 100).toFixed(3)}%)`);
  assert.ok(rel <= 0.02, `blocks ${blocksArea.toFixed(0)} m² vs land ${land} m² (${(rel * 100).toFixed(2)}%)`);
});

test('realism: tito-corridor (alleys excluded) falls inside the La Carpio band at the spec seed', () => {
  const refs = spec.streetStyles.districts[ID]!.reference.map((r) => r.name);
  assert.deepEqual(refs, ['La Carpio']);
  console.log(`# ${ID} (cells, alleys excluded): ${fmt(corridorMetrics(net, spec, 'cells'))}`);
  console.log(`# ${ID} (land, alleys excluded):  ${fmt(corridorMetrics(net, spec, 'land'))}`);
  console.log(`# ${ID} (cells, alleys included): ${fmt(measureDistrict(net, spec, slice.rect, ID, { area: 'cells' }))}`);
  assert.deepEqual(corridorViolations(spec), []);
});

test('seed sweep 1..10: always on playable land inside tito-corridor; at least 8 inside the band (spec seed included)', () => {
  const inBand: number[] = [];
  const leaks: string[] = [];
  for (let seed = 1; seed <= 10; seed++) {
    const v = corridorViolations(spec, { seed }, `seed ${seed}`, (n) => {
      const leak = leavesDistrict(n);
      if (leak) leaks.push(`seed ${seed}: ${leak}`);
    });
    if (v.length === 0) inBand.push(seed);
  }
  assert.deepEqual(leaks, []);
  console.log(`# in band: ${inBand.length}/10 (${inBand.join(', ')})`);
  assert.ok(inBand.includes(spec.streetStyles.seed));
  assert.ok(inBand.length >= 8, `${inBand.length}/10 in band`);
});

test('negative controls: the band rejects the corridor without growth or with a growth mechanism broken', () => {
  // No organic growth at all (the S3 no-op grower).
  assert.ok(corridorViolations(spec, { informal: () => {} }, 'no growth').length > 0, 'no growth must leave the band');
  // Test-local spec copy: segments 3× longer.
  const long = structuredClone(spec);
  const st = long.streetStyles.districts[ID]!;
  assert.equal(st.style, 'informal');
  if (st.style === 'informal') st.growth.segmentLength = [st.growth.segmentLength[0] * 3, st.growth.segmentLength[1] * 3];
  assert.ok(corridorViolations(long, {}, 'segment_length ×3').length > 0, 'segment_length ×3 must leave the band');
  // Streets never stop and branches are never spurs: no dead ends.
  assert.ok(
    corridorViolations(spec, { params: { informalStopProbability: 0, informalSpurProbability: 0 } }, 'no dead ends').length > 0,
    'without dead ends the corridor must leave the band',
  );
  // No infill of large faces.
  assert.ok(corridorViolations(spec, { params: { informalInfillArea: 0 } }, 'no infill').length > 0, 'without infill the corridor must leave the band');
});

test('measure excludeClasses: alleys leave node degrees, street length and blocks (synthetic square)', () => {
  // A 120 m local-street square inside tito-corridor, split in two by an alley.
  const g = new PlanarGraph();
  const props = { cls: 'local' as const, width: 7, sidewalk: 2, fixed: false, district: ID };
  const o = { x: 5000, y: 3000 };
  const c = [o, { x: o.x + 120, y: o.y }, { x: o.x + 120, y: o.y + 120 }, { x: o.x, y: o.y + 120 }];
  for (let i = 0; i < 4; i++) g.addSegment(c[i]!, c[(i + 1) % 4]!, props);
  g.addSegment({ x: o.x + 60, y: o.y }, { x: o.x + 60, y: o.y + 120 }, { ...props, cls: 'alley', width: 3.5, sidewalk: 0 });
  const graph = g.snapshot();
  const all = () => true;
  const blocks = buildBlocks(graph, { isInside: all, districtOf: (p) => districtAt(spec, p)?.id });
  const synth: StreetNetwork = { seed: 0, graph, blocks, stats: { connectors: 0, prunedDangling: 0, closedDeadEnds: 0, linkedIslands: 0, removedFloating: 0, shortEdgesLeft: 0 } };
  const withAlleys = measureDistrict(synth, spec, slice.rect, ID, { isInside: all });
  const noAlleys = measureDistrict(synth, spec, slice.rect, ID, { excludeClasses: ['alley'], isInside: all });
  assert.equal(withAlleys.blocks_measured, 2);
  assert.ok(Math.abs(withAlleys.block_area_median_m2 - 7200) < 1e-6);
  assert.equal(withAlleys.t_share, 1); // two T junctions where the alley meets the square
  assert.equal(noAlleys.blocks_measured, 1);
  assert.ok(Math.abs(noAlleys.block_area_median_m2 - 14400) < 1e-6);
  assert.equal(noAlleys.intersections_per_km2, 0); // only degree-2 corners remain
  assert.ok(Math.abs(withAlleys.street_km_per_km2 / noAlleys.street_km_per_km2 - 600 / 480) < 1e-9);
  assert.equal(withoutClasses(synth, spec, [], all), synth);
});

test('performance: generateStreets on the real spec < 1.5 s cold and warm (median of 3)', () => {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    generateStreets(spec, slice);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  console.log(`# generateStreets cold ${coldMs.toFixed(0)} ms, warm median ${times[1]!.toFixed(0)} ms (runs ${times.map((t) => t.toFixed(0)).join(', ')})`);
  assert.ok(coldMs < 1500, `cold ${coldMs} ms`);
  assert.ok(times[1]! < 1500, `warm ${times[1]} ms`);
});
