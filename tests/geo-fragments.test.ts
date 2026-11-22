/** Pure parts of tools/geo-fragments.mjs (tools/geo-fragments-lib.ts): no engine, no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SIDE_M,
  bboxCenterSize,
  buildProfile,
  buildingStats,
  fillSummary,
  polygonAreaM2,
  reliefStats,
  renderProfile,
  roadClassMix,
  squareBbox,
  toYaml,
} from '../tools/geo-fragments-lib.ts';
import type { ProfileInput } from '../tools/geo-fragments-lib.ts';
import { METERS_PER_DEG_LAT } from '../tools/geo-fragments-lib.ts';

// A 5 x 4 grid at 60° N (cos = 0.5) whose cells are exactly 10 m apart, rising 1 m per cell eastwards
// (slope 10 %) and 2 m per row northwards (slope 20 %): every cell slope is hypot(0.1, 0.2) = 22.36 %.
const step = 10 / METERS_PER_DEG_LAT;
const grid = {
  origin: { latitude: 60, longitude: 0 },
  lat_step: step,
  lon_step: step / Math.cos(Math.PI / 3),
  rows: 4,
  cols: 5,
  heights: Array.from({ length: 20 }, (_, k) => 100 + Math.floor(k / 5) * 2 + (k % 5)),
};

test('reliefStats: heights, relief and slope % from a synthetic grid', () => {
  const s = reliefStats(grid);
  assert.equal(s.height_min_m, 100);
  assert.equal(s.height_max_m, 110);
  assert.equal(s.relief_m, 10);
  assert.equal(s.slope_p50_pct, 22.4);
  assert.equal(s.slope_p99_pct, 22.4);
  assert.deepEqual(s.cell_size_m, [10, 10]);
});

test('reliefStats: slope scales with the horizontal distance (compression makes slopes steeper)', () => {
  const squeezed = { ...grid, lat_step: grid.lat_step / 4, lon_step: grid.lon_step / 4 };
  assert.ok(Math.abs(reliefStats(squeezed).slope_p50_pct - 4 * 22.4) < 0.2);
});

test('roadClassMix: dedupes both directions, shares sum to 1, lane-tag coverage', () => {
  const seg = (u: string, v: string, d: number, cls: string, lanes: number | null) => ({
    from_node_id: u, to_node_id: v, distance_meters: d, source_lane_count: lanes, street: { classification: cls },
  });
  const m = roadClassMix([
    seg('a', 'b', 300, 'residential', null),
    seg('b', 'a', 300, 'residential', null), // reverse direction: same edge
    seg('b', 'c', 100, 'primary', 2),
  ]);
  assert.equal(m.total_km, 0.4);
  assert.deepEqual(m.classes, [
    { class: 'residential', km: 0.3, share: 0.75 },
    { class: 'primary', km: 0.1, share: 0.25 },
  ]);
  assert.equal(m.lane_tag_coverage, 0.5);
});

test('squareBbox: centred, ~size metres per side, cap at 2 km²', () => {
  const b = squareBbox(9.05, -79.5, 800);
  const c = bboxCenterSize(b);
  assert.ok(Math.abs(c.lat - 9.05) < 1e-6 && Math.abs(c.lon + 79.5) < 1e-6);
  assert.ok(Math.abs(c.width_m - 800) <= 4 && Math.abs(c.height_m - 800) <= 4);
  assert.doesNotThrow(() => squareBbox(9, -79, MAX_SIDE_M));
  assert.throws(() => squareBbox(9, -79, MAX_SIDE_M + 1), /2 km²/);
  assert.throws(() => squareBbox(9, -79, 0));
});

test('polygonAreaM2: a 10 x 20 m rectangle, hole subtracted', () => {
  const dx = 10 / METERS_PER_DEG_LAT;
  const dy = 20 / METERS_PER_DEG_LAT;
  const rect = [[0, 0], [dx, 0], [dx, dy], [0, dy], [0, 0]];
  assert.ok(Math.abs(polygonAreaM2({ type: 'Polygon', coordinates: [rect] }, 0) - 200) < 0.01);
  const hole = rect.map(([x, y]) => [(x as number) / 2, (y as number) / 2]);
  assert.ok(Math.abs(polygonAreaM2({ type: 'Polygon', coordinates: [rect, hole] }, 0) - 150) < 0.01);
});

test('buildingStats: sparse OSM coverage gets a data_quality warning, dense does not', () => {
  const dy = 10 / METERS_PER_DEG_LAT;
  const bldg = (x: number) => ({
    geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + dy, 0], [x + dy, dy], [x, dy], [x, 0]]] },
    properties: { levels: 2 },
  });
  const few = buildingStats([bldg(0), bldg(0.001)], 0.64, 0);
  assert.match(few.data_quality, /^sparse/);
  assert.equal(few.footprint_area_m2?.p50, 100);
  assert.equal(few.levels.coverage, 1);
  const many = buildingStats(Array.from({ length: 400 }, (_, i) => bldg(i * 0.0001)), 0.1, 0);
  assert.match(many.data_quality, /^ok/);
});

test('fillSummary: median of the exemplar medians per settlement style', () => {
  const fp = (style: string, w: number) => ({
    width: { median: w, iqr: 1 }, depth: { median: 12, iqr: 2 }, front_setback: { median: 3, iqr: 1 },
    side_gap: { median: 0, iqr: 0 }, coverage: 0.8, median_levels: null, style,
  });
  const s = fillSummary([fp('regular', 8), fp('regular', 12), fp('regular', 20), fp('informal', 5)]);
  assert.deepEqual(s.map((x) => [x.style, x.exemplar_blocks, x.lot_width_m]), [['informal', 1, 5], ['regular', 3, 12]]);
  assert.equal(s[0]?.median_levels, null);
});

const input = (): ProfileInput => {
  const seg = (u: string, v: string, d: number) => ({ properties: { from_node_id: u, to_node_id: v, distance_meters: d, street: { classification: 'residential' } } });
  return {
    fragment: { slug: 'x', import_area_id: 'id-1', bbox: [0, 0, 0.007, 0.007], place_name: 'X' },
    km2: 0.6,
    fingerprints: null,
    mapData: {
      road_segments: { features: [seg('a', 'b', 100), seg('b', 'c', 100), seg('b', 'd', 100)] },
      blocks: { features: [{ properties: { area_square_meters: 5000 } }] },
      buildings: { features: [] },
      pois: { features: [{ properties: { category: 'education' } }] },
      elevation: { source: 's', attribution: 'a', grid },
    },
  };
};

test('renderProfile is deterministic and keeps the extraction date when nothing changed', () => {
  const p = buildProfile(input());
  const first = renderProfile(p, '2026-01-01');
  assert.equal(renderProfile(buildProfile(input()), '2026-01-01'), first);
  assert.equal(renderProfile(buildProfile(input()), '2030-05-05', first), first); // date kept
  const changed = input();
  changed.mapData.pois.features = [];
  const next = renderProfile(buildProfile(changed), '2030-05-05', first);
  assert.notEqual(next, first);
  assert.match(next, /extracted: "2030-05-05"/);
});

test('profile carries provenance, attribution and the street metrics of street-metrics.ts', () => {
  const p = buildProfile(input()) as Record<string, any>;
  assert.equal(p.provenance.import_area_id, 'id-1');
  assert.equal(p.provenance.attribution[0], '© OpenStreetMap contributors');
  assert.equal(p.streets.dead_end_share, 0.75); // a, c, d are dead ends
  assert.equal(p.streets.t_share, 0.25); // b has degree 3
});

test('toYaml: nested objects, arrays of objects, quoting', () => {
  const y = toYaml({ a: 1, 'b-c': { d: [1, 2], e: 'x: y' }, list: [{ k: 1, n: null }, { k: 2, n: true }] });
  assert.equal(y, ['a: 1', 'b-c:', '  d: [1, 2]', '  e: "x: y"', 'list:', '  - k: 1', '    n: null', '  - k: 2', '    n: true'].join('\n'));
});
