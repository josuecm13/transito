import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import type { WorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import type { WorldSlice } from '../src/world/slice.ts';
import type { Vec2 } from '../src/world/vec.ts';
import { pointSegmentDistance } from './streets-check.ts';
import { pointInPolygon } from '../src/world/geometry.ts';
import { buildingCorners } from '../src/world/blockout.ts';
import type { City, EdgeProps, StreetNetwork } from '../src/world/streets/index.ts';
import { PlanarGraph, buildBlocks, deriveCity, generateStreets } from '../src/world/streets/index.ts';
import { badFrontages, buildingsInParcels, buildingsOnStreets, distToFootprint, parcelsOutsideBuildable } from './city-check.ts';

const spec = parseWorldSpec(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
const slice = sliceWorld(spec);
const net = generateStreets(spec, slice);
const city = deriveCity(spec, slice, net);

// ------------------------------------------------------------------ synthetic case
const v = (x: number, y: number) => ({ x, y });
const local: EdgeProps = { cls: 'local', width: 7, sidewalk: 2, fixed: false, district: 'd' };
const collector: EdgeProps = { cls: 'collector', width: 10, sidewalk: 2.5, fixed: false, district: 'd' };
const avenue: EdgeProps = { cls: 'avenue', width: 14, sidewalk: 3, fixed: true, routeId: 'av' };
const alley: EdgeProps = { cls: 'alley', width: 3.5, sidewalk: 0, fixed: false, district: 'd' };
const frame = (kind: 'area' | 'coast'): EdgeProps => ({ cls: 'frame', width: 0, sidewalk: 0, fixed: false, frame: kind });

/**
 * 6×5 blocks of 110 m: x = 0..660, y = 0..550. West side is coast (frame), the rest of the
 * outline is the area frame. y = 220 is an avenue, x = 330 a collector, a slanted local and a
 * curved local cut through, a dead-end local and an alley poke into blocks, and a second street
 * 12 m from y = 440 makes a strip too thin to build on (median).
 */
function syntheticNet(): StreetNetwork {
  const g = new PlanarGraph();
  g.addPolyline([v(0, 0), v(660, 0), v(660, 550), v(0, 550)], frame('area'));
  g.addSegment(v(0, 0), v(0, 550), frame('coast'));
  for (let i = 1; i < 5; i++) g.addSegment(v(0, i * 110), v(660, i * 110), i === 2 ? avenue : local);
  for (let i = 1; i < 6; i++) g.addSegment(v(i * 110, 0), v(i * 110, 550), i === 3 ? collector : local);
  g.addSegment(v(440, 452), v(660, 452), local); // thin strip 440..452 → median
  g.addSegment(v(0, 30), v(110, 75), local); // slanted
  g.addPolyline([v(110, 300), v(150, 310), v(185, 330), v(220, 360)], local); // curved
  g.addSegment(v(550, 55), v(600, 55), local); // dead end inside a block
  g.addSegment(v(220, 495), v(275, 495), alley);
  const graph = g.snapshot();
  const blocks = buildBlocks(graph, { isInside: () => true, districtOf: () => 'd' });
  return { seed: 1, graph, blocks, stats: { connectors: 0, prunedDangling: 0, closedDeadEnds: 0, linkedIslands: 0, removedFloating: 0, shortEdgesLeft: 0 } };
}

const synLandmark = { id: 'lm', district: 'd', position: v(385, 385), kind: 'test', onWater: false };
const synSpec: WorldSpec = {
  ...spec,
  routes: [],
  blockout: { seed: 7, landmarkClearance: 18, districts: { d: { lot: 22, footprint: [8, 16], height: [4, 10], setback: 4, fill: 0.9, angle: 0 } } },
  streetStyles: {
    ...spec.streetStyles,
    districts: { d: { style: 'formal', field: [], spacing: { collector: 400, local: 50 }, reference: [], landUse: { park: 0.1, court: 0.1 } } },
  },
};
const synSlice: WorldSlice = { ...slice, rect: { minX: 0, minY: 0, maxX: 660, maxY: 550 }, landmarks: [synLandmark], isPlayableLand: () => true };
const synNet = syntheticNet();
const synCity = deriveCity(synSpec, synSlice, synNet);

const cases: [string, WorldSpec, WorldSlice, StreetNetwork, City][] = [
  ['real area', spec, slice, net, city],
  ['synthetic', synSpec, synSlice, synNet, synCity],
];

test('deriveCity produces parcels and buildings (real area and synthetic)', () => {
  for (const [name, , , n, c] of cases) {
    assert.equal(c.buildable.length, n.blocks.length, name);
    assert.equal(c.landUse.length, n.blocks.length, name);
    assert.ok(c.parcels.length > 20, `${name}: ${c.parcels.length} parcels`);
    assert.ok(c.buildings.length > 10, `${name}: ${c.buildings.length} buildings`);
  }
});

test('determinism: same input → deep-equal city', () => {
  assert.deepEqual(deriveCity(spec, slice, net), city);
  assert.deepEqual(deriveCity(synSpec, synSlice, syntheticNet()), synCity);
});

test('every building lies inside exactly one parcel (strict containment, no overlap with others)', () => {
  for (const [name, , , , c] of cases) assert.deepEqual(buildingsInParcels(c), [], name);
});

test('every parcel lies inside its block buildable area', () => {
  for (const [name, , , , c] of cases) assert.deepEqual(parcelsOutsideBuildable(c), [], name);
});

test('polygon-clipping never takes the conservative fallback (real area and synthetic)', () => {
  for (const [name, , , , c] of cases) assert.equal(c.stats.clipFallbacks, 0, `${name}: ${c.stats.clipRetries} retries, ${c.stats.clipFallbacks} fallbacks`);
});

test('every parcel has street frontage on a real street (not frame), at that street buffer line', () => {
  for (const [name, , , n, c] of cases) assert.deepEqual(badFrontages(c, n.graph), [], name);
});

test('no building on a carriageway or sidewalk (brute force against every street edge)', () => {
  for (const [name, , , n, c] of cases) assert.deepEqual(buildingsOnStreets(c, n.graph), [], name);
});

test('buildings respect landmark clearance (and the check is not vacuous in the synthetic case)', () => {
  for (const [name, s, sl, , c] of cases) {
    for (const b of c.buildings) {
      const corners = buildingCorners(b);
      for (const lm of sl.landmarks) {
        const d = distToFootprint(lm.position, corners);
        assert.ok(d >= s.blockout.landmarkClearance, `${name}: building at ${b.center.x.toFixed(1)},${b.center.y.toFixed(1)} is ${d.toFixed(2)} m from ${lm.id}`);
      }
    }
  }
  const nearLm = synCity.parcels.filter((p) => p.poly.outer.some((q) => Math.hypot(q.x - synLandmark.position.x, q.y - synLandmark.position.y) < 25));
  assert.ok(nearLm.length > 0, 'some parcel lies near the synthetic landmark');
});

test('medians: buildable parts empty exactly for medians; the thin synthetic strip is one', () => {
  for (const [name, , , , c] of cases) {
    for (const b of c.buildable) assert.equal(b.isMedian, b.parts.length === 0, `${name}: block ${b.block}`);
  }
  const strip = synNet.blocks.filter((b) => b.ring.every((p) => p.y >= 440 - 1e-9 && p.y <= 452 + 1e-9));
  assert.ok(strip.length >= 1, 'strip blocks exist');
  for (const b of strip) assert.equal(synCity.buildable[b.id]!.isMedian, true, `strip block ${b.id}`);
  assert.ok(synCity.buildable.filter((b) => !b.isMedian).length >= 25);
});

test('land use: park / court counts per district follow the spec fractions; none are medians or hold buildings', () => {
  for (const [name, s, sl, n, c] of cases) {
    for (const [id, style] of Object.entries(s.streetStyles.districts)) {
      const live = n.blocks.filter((b) => b.district === id && !c.buildable[b.id]!.isMedian);
      const count = (use: string) => c.landUse.filter((u) => u.district === id && u.use === use).length;
      const touches = (ring: Vec2[], lm: (typeof sl.landmarks)[number]) =>
        pointInPolygon(lm.position, ring) ||
        (lm.triggerRadius !== undefined && ring.some((q, i) => pointSegmentDistance(lm.position, q, ring[(i + 1) % ring.length]!).d < lm.triggerRadius!));
      const eligible = live.filter((b) => !sl.landmarks.some((lm) => touches(b.ring, lm)));
      const wantCourt = Math.min(Math.round(style.landUse.court * live.length), eligible.length);
      const wantPark = Math.min(Math.round(style.landUse.park * live.length), eligible.length - wantCourt);
      assert.equal(count('court'), wantCourt, `${name} ${id}: courts of ${live.length} blocks`);
      assert.equal(count('park'), wantPark, `${name} ${id}: parks of ${live.length} blocks`);
    }
    const green = new Set(c.landUse.filter((u) => u.use === 'park' || u.use === 'court').map((u) => u.block));
    for (const b of green) {
      assert.equal(c.buildable[b]!.isMedian, false, `${name}: green block ${b} is a median`);
      assert.equal(n.blocks[b]!.isMedian && c.buildable[b]!.isMedian, false);
      for (const lm of sl.landmarks) assert.ok(!pointInPolygon(lm.position, n.blocks[b]!.ring), `${name}: green block ${b} holds ${lm.id}`);
    }
    assert.equal(c.parcels.filter((p) => green.has(p.block)).length, 0, `${name}: parcels on green blocks`);
    assert.equal(c.buildings.filter((p) => green.has(p.block)).length, 0, `${name}: buildings on green blocks`);
    for (const u of c.landUse) if (u.use === 'median') assert.equal(c.buildable[u.block]!.isMedian, true);
  }
  // Synthetic: 0.1 · N each, so both kinds are present.
  assert.ok(synCity.landUse.some((u) => u.use === 'park') && synCity.landUse.some((u) => u.use === 'court'));
  // Commercial = fronting an avenue.
  for (const u of synCity.landUse) {
    if (u.use !== 'commercial' && u.use !== 'residential') continue;
    const fronts = synNet.blocks[u.block]!.boundary.some((r) => synNet.graph.edges[r.edge]!.cls === 'avenue');
    assert.equal(u.use === 'commercial', fronts, `block ${u.block}`);
  }
});

test('performance: deriveCity on the real active area < 500 ms in Node', () => {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    deriveCity(spec, slice, net);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const median = times[1]!;
  console.log(`deriveCity real area: ${times.map((t) => t.toFixed(0)).join(' / ')} ms (median ${median.toFixed(0)})`);
  assert.ok(median < 500, `median ${median.toFixed(0)} ms`);
});
