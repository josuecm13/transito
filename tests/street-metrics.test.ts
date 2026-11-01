import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeStreetMetrics,
  mapDataToMetricsInput,
  percentileCont,
  type MapDataLike,
  type StreetMetrics,
  type StreetMetricsInput,
} from '../src/world/street-metrics.ts';

const near = (a: number, b: number, msg = '') => assert.ok(Math.abs(a - b) < 1e-9, `${msg} ${a} !~ ${b}`);

test('percentileCont: linear interpolation between closest ranks (Postgres semantics)', () => {
  assert.equal(percentileCont([], 0.5), 0);
  assert.equal(percentileCont([7], 0.9), 7);
  near(percentileCont([1, 2, 3, 4], 0.5), 2.5);
  near(percentileCont([1000, 2000, 3000, 4000], 0.1), 1300);
  near(percentileCont([1000, 2000, 3000, 4000], 0.9), 3700);
  assert.equal(percentileCont([1, 2, 3], 0), 1);
  assert.equal(percentileCont([1, 2, 3], 1), 3);
});

/**
 * 3x3 grid, 100 m spacing (200 m x 200 m = 0.04 km²), plus a 50 m spur east of the middle-right
 * node. Every edge is given in both directions and one is repeated, like the engine's directed
 * segments.
 *
 *   (0,2)-(1,2)-(2,2)
 *     |     |     |
 *   (0,1)-(1,1)-(2,1)--S
 *     |     |     |
 *   (0,0)-(1,0)-(2,0)
 *
 * Degrees: 4 corners = 2 (excluded), (1,0) (0,1) (1,2) = 3, (1,1) (2,1) = 4, S = 1.
 * Intersections = 6 -> dead 1/6, T 3/6, X 2/6. Edges: 12 x 100 + 50 = 1250 m over 13 edges.
 */
function gridInput(): StreetMetricsInput {
  const id = (x: number, y: number) => `n${x}${y}`;
  const undirected: [string, string, number][] = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) undirected.push([id(x, y), id(x + 1, y), 100]);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 2; y++) undirected.push([id(x, y), id(x, y + 1), 100]);
  undirected.push([id(2, 1), 'S', 50]);
  const edges = undirected.flatMap(([u, v, length]) => [
    { u, v, length },
    { u: v, v: u, length },
  ]);
  edges.push({ u: id(1, 1), v: id(1, 0), length: 100 }); // exact duplicate
  return {
    edges,
    blocks: [
      { area: 3000 },
      { area: 1000 },
      { area: 4000, isMedian: false, isClipped: false },
      { area: 2000 },
      { area: 50, isMedian: true },
      { area: 99999, isClipped: true },
    ],
    areaKm2: 0.04,
  };
}

test('synthetic grid with spur: exact hand-computed metrics', () => {
  const m = computeStreetMetrics(gridInput());
  const expected: StreetMetrics = {
    blocks_measured: 4,
    block_area_p10_m2: 1300,
    block_area_median_m2: 2500,
    block_area_p90_m2: 3700,
    dead_end_share: 1 / 6,
    t_share: 3 / 6,
    x_share: 2 / 6,
    intersections_per_km2: 150,
    street_km_per_km2: 31.25,
    mean_segment_m: 1250 / 13,
  };
  assert.deepEqual(Object.keys(m).sort(), Object.keys(expected).sort());
  for (const k of Object.keys(expected) as (keyof StreetMetrics)[]) near(m[k], expected[k], k);
});

test('dedupe key includes length (parallel edges count), ids compare as text', () => {
  // a-b twice with different lengths (parallel streets) + b-c: a deg 2, b deg 3, c deg 1.
  const m = computeStreetMetrics({
    edges: [
      { u: 1, v: 2, length: 10 },
      { u: '2', v: '1', length: 10 },
      { u: 2, v: 1, length: 30 },
      { u: 2, v: 3, length: 20 },
    ],
    blocks: [],
    areaKm2: 1,
  });
  assert.equal(m.intersections_per_km2, 2);
  near(m.dead_end_share, 0.5);
  near(m.t_share, 0.5);
  near(m.mean_segment_m, 20);
  near(m.street_km_per_km2, 0.06);
  assert.equal(m.blocks_measured, 0);
});

type Fixture = {
  import_area_id: string;
  km2: number;
  attribution: string;
  road_segments: [string, string, number][];
  blocks: [number, boolean, boolean][];
};

function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'street-refs', `${name}.json`), 'utf8'));
}

/** Rebuild the engine map-data shape so the adapter is exercised too. */
function toMapData(f: Fixture): MapDataLike {
  return {
    road_segments: {
      features: f.road_segments.map(([from_node_id, to_node_id, distance_meters]) => ({
        properties: { from_node_id, to_node_id, distance_meters },
      })),
    },
    blocks: {
      features: f.blocks.map(([area_square_meters, is_median, is_clipped]) => ({
        properties: { area_square_meters, is_median, is_clipped },
      })),
    },
  };
}

// SQL results from issue #7 Evidence (geodb, 2026-10-31).
const SQL: Record<string, StreetMetrics> = {
  'la-carpio': {
    blocks_measured: 53,
    block_area_p10_m2: 2571.509771051863,
    block_area_median_m2: 6053.310631058179,
    block_area_p90_m2: 14728.78847741571,
    dead_end_share: 0.3,
    t_share: 0.6,
    x_share: 0.1,
    intersections_per_km2: 156.9039,
    street_km_per_km2: 19.483874,
    mean_segment_m: 93.466661,
  },
  'santa-ana': {
    blocks_measured: 477,
    block_area_p10_m2: 485.04958288548517,
    block_area_median_m2: 4304.754586415918,
    block_area_p90_m2: 15211.42355083202,
    dead_end_share: 0.224937,
    t_share: 0.632206,
    x_share: 0.142857,
    intersections_per_km2: 161.9106,
    street_km_per_km2: 15.946345,
    mean_segment_m: 67.433636,
  },
};

const SHARES = new Set<keyof StreetMetrics>(['dead_end_share', 't_share', 'x_share']);

for (const name of Object.keys(SQL)) {
  test(`parity with reference SQL: ${name} (filter-mode map-data)`, () => {
    const f = loadFixture(name);
    assert.equal(f.attribution, '© OpenStreetMap contributors');
    const m = computeStreetMetrics(mapDataToMetricsInput(toMapData(f), f.km2));
    const want = SQL[name] as StreetMetrics;
    assert.equal(m.blocks_measured, want.blocks_measured, 'blocks_measured');
    for (const k of Object.keys(want) as (keyof StreetMetrics)[]) {
      if (k === 'blocks_measured') continue;
      if (SHARES.has(k)) {
        assert.ok(Math.abs(m[k] - want[k]) <= 0.01, `${k}: ${m[k]} vs SQL ${want[k]} (> 1 pt)`);
      } else {
        const rel = Math.abs(m[k] - want[k]) / Math.abs(want[k]);
        assert.ok(rel <= 0.02, `${k}: ${m[k]} vs SQL ${want[k]} (rel ${(rel * 100).toFixed(2)}% > 2%)`);
      }
    }
  });
}
