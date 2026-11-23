import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDifferentData, assertSameData, determinismTest } from './determinism.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec, WorldSpecError } from '../src/world/spec.ts';
import type { FrontageLots, WorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import type { WorldSlice } from '../src/world/slice.ts';
import { buildingCorners } from '../src/world/blockout.ts';
import { pointInPolygon } from '../src/world/geometry.ts';
import type { Vec2 } from '../src/world/vec.ts';
import type { City, EdgeProps, StreetNetwork } from '../src/world/streets/index.ts';
import { PlanarGraph, buildBlocks, deriveCity, drawStoreys, generateStreets, sampleDimension, stableUnit } from '../src/world/streets/index.ts';
import { createRng } from '../src/world/rng.ts';
import { buildingsOnStreets, distToFootprint, segDist } from './city-check.ts';
import { measureFrontage } from './frontage-check.ts';
import type { FrontageFingerprint } from './frontage-check.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const spec = parseWorldSpec(yaml);
const slice = sliceWorld(spec);
const net = generateStreets(spec, slice);
const DISTRICT = 'tito-corridor';
const fl = spec.blockout.districts[DISTRICT]!.frontageLots!;
const city = deriveCity(spec, slice, net);
const lotBuildings = (c: City) => c.buildings.filter((b) => b.parcel === -1);

/** The spec with the corridor's frontage fingerprint replaced. */
const withLots = (s: WorldSpec, patch: Partial<FrontageLots>): WorldSpec => ({
  ...s,
  blockout: { ...s.blockout, districts: { ...s.blockout.districts, [DISTRICT]: { ...s.blockout.districts[DISTRICT]!, frontageLots: { ...fl, ...patch } } } },
});

// ------------------------------------------------------------------ spec

test('spec: tito-corridor carries the La Carpio frontage fingerprint', () => {
  const d = spec.blockout.districts[DISTRICT]!;
  assert.equal(d.method, 'frontage-lots');
  assert.deepEqual(fl.width, { median: 9, iqr: 4.5 });
  assert.deepEqual(fl.depth, { median: 12.2, iqr: 5.5 });
  assert.deepEqual(fl.frontSetback, { median: 1.1, iqr: 2.2 });
  assert.deepEqual(fl.sideGap, { median: 0, iqr: 0 });
  assert.equal(fl.coverage, 0.98);
  // The other districts keep the parcel method.
  for (const [id, b] of Object.entries(spec.blockout.districts)) if (id !== DISTRICT) assert.equal(b.method, 'parcels', id);
  assert.match(yaml, /© OpenStreetMap contributors/);
  assert.match(yaml, /a249a461-91e7-4299-961e-5b9b16e0f1d8/);
});

test('spec: a broken frontage_lots block reports its problems', () => {
  const broken = (from: RegExp, to: string): void => {
    const text = yaml.replace(from, to);
    assert.notEqual(text, yaml, `mutation ${from} must change the yaml`);
    assert.throws(() => parseWorldSpec(text), WorldSpecError, String(from));
  };
  broken(/width:\s+{ median: 9\.0,\s+iqr: 4\.5 }/, 'width: { median: 9.0 }');
  broken(/side_gap:\s+{ median: 0\.0,\s+iqr: 0\.0 }/, 'side_gap: { median: -1, iqr: 0.0 }');
  broken(/two_storey_share: 0\.3/, 'two_storey_share: 1.5');
  broken(/^ {6}method: frontage-lots/m, '      method: lots');
  broken(/level_height: 3/, 'level_height: 0');
  const noBlock = yaml.replace(/ {6}frontage_lots:\n( {8}.*\n)+/, '');
  assert.notEqual(noBlock, yaml);
  assert.throws(() => parseWorldSpec(noBlock), WorldSpecError, 'frontage-lots without its block');
});

test('port: stableUnit / drawStoreys match the engine (values pinned by its own tests)', () => {
  assert.equal(stableUnit('a'), 444641715 / 2 ** 32);
  assert.equal(stableUnit('way/123'), 1071952468 / 2 ** 32);
  assert.equal(drawStoreys('a', 0.3), 2); // 0.1035 < 0.3
  assert.equal(drawStoreys('a', 0.1), 1); // 0.1035 >= 0.1
  assert.equal(drawStoreys('way/123', 0.3), 2); // 0.2496 < 0.3
  assert.equal(drawStoreys('way/123', 0.2), 1);
});

test('port: sampleDimension stays within [0.5, 1.5] x median and is exactly the median when iqr is 0', () => {
  const rng = createRng(3);
  const v = Array.from({ length: 2000 }, () => sampleDimension(rng, { median: 9, iqr: 4.5 }));
  assert.ok(Math.min(...v) >= 4.5 && Math.max(...v) <= 13.5);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(Math.abs(mean - 9) < 0.3, `mean ${mean}`);
  assert.equal(sampleDimension(rng, { median: 0, iqr: 0 }), 0);
  assert.equal(sampleDimension(rng, { median: 5, iqr: 0 }), 5);
});

// ------------------------------------------------------------------ real corridor

test('corridor: buildings come from frontage lots (no parcels in the district), other districts keep parcels', () => {
  const lots = lotBuildings(city);
  assert.ok(lots.length > 1000, `${lots.length} frontage-lot buildings`);
  assert.ok(lots.every((b) => b.district === DISTRICT));
  assert.ok(city.parcels.every((p) => p.district !== DISTRICT));
  assert.ok(city.buildings.filter((b) => b.parcel >= 0).every((b) => b.district !== DISTRICT));
  // Heights are whole storeys of the spec's level height.
  for (const b of lots) assert.ok(b.height === fl.levelHeight || b.height === 2 * fl.levelHeight, `height ${b.height}`);
});

determinismTest('same input gives an identical city; another seed does not', () => {
  assertSameData(deriveCity(spec, slice, net), city, 'deriveCity(same input)');
  const other = deriveCity({ ...spec, blockout: { ...spec.blockout, seed: spec.blockout.seed + 1 } }, slice, net);
  assertDifferentData(lotBuildings(other).map((b) => b.center), lotBuildings(city).map((b) => b.center), 'lot building centers for seed + 1 vs seed');
});

/** Area of the intersection of two convex CCW polygons (Sutherland–Hodgman; no clipping library). */
function convexOverlapArea(subject: readonly Vec2[], clip: readonly Vec2[]): number {
  let out: Vec2[] = [...subject];
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const side = (p: Vec2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!;
      const q = input[(j + 1) % input.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  let s = 0;
  for (let i = 0; i < out.length; i++) s += out[i]!.x * out[(i + 1) % out.length]!.y - out[(i + 1) % out.length]!.x * out[i]!.y;
  return Math.abs(s) / 2;
}

const longestEdge = (k: readonly { x: number; y: number }[]): number =>
  Math.max(...k.map((p, i) => Math.hypot(k[(i + 1) % k.length]!.x - p.x, k[(i + 1) % k.length]!.y - p.y)));

const overlaps = (c: City): string[] => {
  const bad: string[] = [];
  const byBlock = new Map<number, number[]>();
  c.buildings.forEach((b, i) => byBlock.set(b.block, [...(byBlock.get(b.block) ?? []), i]));
  const ring = (i: number) => {
    const k = buildingCorners(c.buildings[i]!);
    return { k, minX: Math.min(...k.map((p) => p.x)), maxX: Math.max(...k.map((p) => p.x)), minY: Math.min(...k.map((p) => p.y)), maxY: Math.max(...k.map((p) => p.y)) };
  };
  for (const ids of byBlock.values()) {
    const r = ids.map(ring);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = r[i]!;
        const b = r[j]!;
        if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) continue;
        const area = convexOverlapArea(a.k, b.k);
        // The generator tolerates 0.02 m of interpenetration (rounding). A sliver that thin covers at most
        // 0.02 m × the longest edge of the pair (0.31 m² for two 18 m buildings side by side), so the bound
        // scales with the edge instead of a flat 0.3 m².
        const longest = Math.max(longestEdge(a.k), longestEdge(b.k));
        if (area > 0.02 * longest + 1e-6) bad.push(`buildings ${ids[i]} and ${ids[j]} overlap by ${area.toFixed(2)} m²`);
      }
    }
  }
  return bad;
};

test('no two buildings overlap (brute-force convex clipping), corners included', () => {
  assert.deepEqual(overlaps(city), []);
});

/** Every frontage-lot building inside a buildable part of its block, setback away from its edges. */
const outsideGround = (c: City, setback: number): string[] => {
  const bad: string[] = [];
  c.buildings.forEach((b, i) => {
    if (b.parcel !== -1) return;
    const k = buildingCorners(b);
    const parts = c.buildable[b.block]!.parts;
    const part = parts.find((p) => k.every((q) => pointInPolygon(q, p.outer) && !p.holes.some((h) => pointInPolygon(q, h))));
    if (!part) return void bad.push(`building ${i} is not inside any buildable part of block ${b.block}`);
    let d = Infinity;
    for (const ringP of [part.outer, ...part.holes]) {
      for (let e = 0; e < ringP.length; e++) {
        for (let s = 0; s < 4; s++) d = Math.min(d, segDist(k[s]!, k[(s + 1) % 4]!, ringP[e]!, ringP[(e + 1) % ringP.length]!));
      }
    }
    if (d < setback - 0.02) bad.push(`building ${i} is ${d.toFixed(3)} m from its block's buildable edge (< setback ${setback})`);
  });
  return bad;
};

test('buildings sit inside their block buildable area, at least the front setback from its edges, and never on a street', () => {
  assert.deepEqual(outsideGround(city, fl.frontSetback.median), []);
  assert.deepEqual(buildingsOnStreets(city, net.graph), []);
});

test('landmark clearance holds, and a landmark dropped in the dense corridor really clears buildings', () => {
  const target = lotBuildings(city)[Math.floor(lotBuildings(city).length / 2)]!;
  const lm = { id: 'probe', district: DISTRICT, position: target.center, kind: 'test', onWater: false };
  const probed = deriveCity(spec, { ...slice, landmarks: [...slice.landmarks, lm] } as WorldSlice, net);
  assert.ok(probed.buildings.length < city.buildings.length, 'the probe landmark removed buildings');
  for (const b of probed.buildings) assert.ok(distToFootprint(lm.position, buildingCorners(b)) >= spec.blockout.landmarkClearance, 'inside clearance');
});

// ------------------------------------------------------------------ fingerprint band

/** Stated band around the La Carpio numbers (see world.yaml `frontage_lots`). */
const BAND = {
  coverageBelow: 0.08, //     coverage >= spec.coverage - 0.08  (corner setbacks cost the rest)
  widthRel: 0.2, //           width median within ±20 %
  depthRel: 0.15, //          depth median within ±15 %
  setbackAbs: 0.5, //         front setback median within ±0.5 m
  sideGapMax: 0.5, //         side gap median at most 0.5 m
};

function bandViolations(fp: FrontageFingerprint, lots: FrontageLots): string[] {
  const out: string[] = [];
  if (!(fp.coverage >= lots.coverage - BAND.coverageBelow)) out.push(`coverage ${fp.coverage.toFixed(3)} < ${(lots.coverage - BAND.coverageBelow).toFixed(2)}`);
  if (!(Math.abs(fp.width / lots.width.median - 1) <= BAND.widthRel)) out.push(`width ${fp.width.toFixed(2)} vs ${lots.width.median}`);
  if (!(Math.abs(fp.depth / lots.depth.median - 1) <= BAND.depthRel)) out.push(`depth ${fp.depth.toFixed(2)} vs ${lots.depth.median}`);
  if (!(Math.abs(fp.setback - lots.frontSetback.median) <= BAND.setbackAbs)) out.push(`setback ${fp.setback.toFixed(2)} vs ${lots.frontSetback.median}`);
  if (!(fp.sideGap <= BAND.sideGapMax)) out.push(`side gap ${fp.sideGap.toFixed(2)} > ${BAND.sideGapMax}`);
  return out;
}

const measured = measureFrontage(city, net.graph, DISTRICT);

test('measured fingerprint of the generated corridor lands inside the La Carpio band', () => {
  console.log(`corridor fingerprint: ${JSON.stringify(measured)}`);
  assert.ok(measured.samples > 20000 && measured.buildings > 1000, 'the measurement saw the corridor');
  assert.deepEqual(bandViolations(measured, fl), []);
});

test('negative controls: a wider side gap, a deeper setback, or sparse lots fall outside the band', () => {
  const run = (patch: Partial<FrontageLots>) => measureFrontage(deriveCity(withLots(spec, patch), slice, net), net.graph, DISTRICT);
  const gapped = run({ sideGap: { median: 4, iqr: 0 } });
  assert.ok(bandViolations(gapped, fl).some((v) => v.startsWith('side gap')), `gap ×4: ${JSON.stringify(gapped)}`);
  const sparse = run({ sideGap: { median: 9, iqr: 0 } });
  assert.ok(bandViolations(sparse, fl).some((v) => v.startsWith('coverage')), `coverage ~0.5: ${JSON.stringify(sparse)}`);
  assert.ok(sparse.coverage < 0.7, `sparse coverage ${sparse.coverage}`);
  const suburban = run({ frontSetback: { median: 4, iqr: 0 } });
  assert.ok(bandViolations(suburban, fl).some((v) => v.startsWith('setback')), `setback 4: ${JSON.stringify(suburban)}`);
});

// ------------------------------------------------------------------ synthetic grid (corners)

const v = (x: number, y: number) => ({ x, y });
const local: EdgeProps = { cls: 'local', width: 7, sidewalk: 2, fixed: false, district: 'd' };
const alley: EdgeProps = { cls: 'alley', width: 3.5, sidewalk: 0, fixed: false, district: 'd' };
const frame: EdgeProps = { cls: 'frame', width: 0, sidewalk: 0, fixed: false, frame: 'area' };

/** 4×3 blocks of 90 m with a slanted street and an alley: right, acute and obtuse corners. */
function syntheticNet(): StreetNetwork {
  const g = new PlanarGraph();
  g.addPolyline([v(0, 0), v(360, 0), v(360, 270), v(0, 270)], frame);
  g.addSegment(v(0, 0), v(0, 270), frame);
  for (let i = 1; i < 3; i++) g.addSegment(v(0, i * 90), v(360, i * 90), local);
  for (let i = 1; i < 4; i++) g.addSegment(v(i * 90, 0), v(i * 90, 270), local);
  g.addSegment(v(0, 45), v(90, 80), local);
  g.addSegment(v(135, 135), v(135, 180), alley);
  const graph = g.snapshot();
  const blocks = buildBlocks(graph, { isInside: () => true, districtOf: () => 'd' });
  return { seed: 1, graph, blocks, stats: { connectors: 0, prunedDangling: 0, closedDeadEnds: 0, linkedIslands: 0, removedFloating: 0, shortEdgesLeft: 0 } };
}

const synSpec: WorldSpec = {
  ...spec,
  routes: [],
  blockout: { seed: 5, landmarkClearance: 18, districts: { d: { ...spec.blockout.districts[DISTRICT]! } } },
  streetStyles: {
    ...spec.streetStyles,
    districts: { d: { style: 'formal', field: [], spacing: { collector: 400, local: 50 }, reference: [], landUse: { park: 0, court: 0 } } },
  },
};
const synSlice: WorldSlice = { ...slice, rect: { minX: 0, minY: 0, maxX: 360, maxY: 270 }, landmarks: [], isPlayableLand: () => true };
const synNet = syntheticNet();
const synCity = deriveCity(synSpec, synSlice, synNet);

test('synthetic grid: lots along every street, deterministic, no overlap, setback kept at right/acute/obtuse corners', () => {
  const b = synCity.buildings;
  assert.ok(b.length > 40, `${b.length} buildings`);
  assert.ok(b.every((x) => x.parcel === -1));
  assert.deepEqual(deriveCity(synSpec, synSlice, syntheticNet()), synCity);
  assert.deepEqual(overlaps(synCity), []);
  assert.deepEqual(outsideGround(synCity, fl.frontSetback.median), []);
  assert.deepEqual(buildingsOnStreets(synCity, synNet.graph), []);
  const fp = measureFrontage(synCity, synNet.graph, 'd');
  assert.deepEqual(bandViolations(fp, fl), [], JSON.stringify(fp));
});
