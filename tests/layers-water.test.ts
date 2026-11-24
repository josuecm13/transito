import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { parseWorldSpec } from '../src/world/spec.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { layer2Relief } from '../src/world/layers/layer2-relief.ts';
import { enforceMonotone, layer3Water } from '../src/world/layers/layer3-water.ts';
import type { Layer3Output, WaterPolygon } from '../src/world/layers/layer3-water.ts';
import { shoreEdges } from '../src/world/layers/layer1-land-cover.ts';
import { distanceToPolyline, pointInPolygon } from '../src/world/geometry.ts';
import type { Vec2 } from '../src/world/vec.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const spec = parseWorldSpec(yaml);
const world = buildWorldData(yaml);
const l3: Layer3Output = world.water;
const terrain = world.terrain;

const segDist = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const coastEdges = shoreEdges(spec);
const coastDist = (p: Vec2): number => Math.min(...coastEdges.map(([a, b]) => segDist(p, a, b)));
const ringDist = (p: Vec2, ring: readonly Vec2[]): number => Math.min(...ring.map((a, i) => segDist(p, a, ring[(i + 1) % ring.length] as Vec2)));
const inLand = (p: Vec2): boolean => pointInPolygon({ x: Math.min(spec.bounds.width - 0.01, Math.max(0.01, p.x)), y: p.y }, spec.land);
const landmark = (id: string): Vec2 => {
  const l = spec.landmarks.find((m) => m.id === id);
  assert.ok(l, `landmark ${id}`);
  return l.position;
};
const tol = spec.rivers.mouthTolerance;
const lakeBody = spec.waterBodies.find((b) => b.kind === 'lake')!;
const half = spec.canal.width / 2;

test('layer 3 is deterministic and does not mutate the spec', () => {
  const before = JSON.stringify(spec);
  const l2 = layer2Relief(spec, {});
  const a = layer3Water(spec, { layer2: l2 });
  const b = layer3Water(spec, { layer2: l2 });
  assert.deepEqual(a, b);
  assert.deepEqual(a, l3);
  assert.equal(JSON.stringify(spec), before);
  assert.equal(a.generated, true);
});

test('monotone fix: a running minimum never rises, and raises nothing that was already monotone', () => {
  assert.deepEqual(enforceMonotone([5, 4, 4.5, 3, 3.2, 1]), [5, 4, 4, 3, 3, 1]);
  assert.deepEqual(enforceMonotone([5, 4, 3]), [5, 4, 3]);
});

test('every river descends monotonically from source to outlet, and ends at the level of its outlet', () => {
  assert.equal(l3.rivers.length, spec.rivers.items.length);
  for (const r of l3.rivers) {
    assert.ok(r.points.length > 20, `${r.id}: course has ${r.points.length} vertices`);
    for (let i = 1; i < r.surface.length; i++) {
      assert.ok((r.surface[i] as number) <= (r.surface[i - 1] as number), `${r.id}: surface rises at vertex ${i} (${r.surface[i - 1]} -> ${r.surface[i]})`);
      assert.ok((r.drainageKm2[i] as number) >= (r.drainageKm2[i - 1] as number), `${r.id}: drainage shrinks downstream at vertex ${i}`);
    }
    assert.ok((r.surface[0] as number) > (r.surface[r.surface.length - 1] as number), `${r.id}: the river does not descend at all`);
    const level = r.outlet === 'coast' ? spec.canal.seaLevel : spec.canal.lakeLevel;
    assert.equal(r.surface[r.surface.length - 1], level, `${r.id}: surface at the mouth is ${r.surface[r.surface.length - 1]}, outlet level ${level}`);
    // Width follows hydraulic geometry: non-decreasing downstream, capped by max_width.
    for (let i = 1; i < r.width.length; i++) assert.ok((r.width[i] as number) >= (r.width[i - 1] as number) - 1e-9, `${r.id}: width shrinks downstream`);
    assert.ok(Math.max(...r.width) <= spec.rivers.maxWidth + 1e-9);
    // The water never stands above the ground it was carved from (pits are breached, not filled).
    assert.ok(r.maxFill <= 0.5, `${r.id}: surface stands ${r.maxFill.toFixed(2)} m above the uncarved ground`);
  }
  assert.equal(Math.max(...l3.rivers.map((r) => Math.max(...r.width))), spec.rivers.maxWidth, 'the largest river reaches max_width');
});

test('every coast outlet is on the coastline within tolerance; the Chagres outlet is on the gatun-lake shore', () => {
  for (const r of l3.rivers) {
    const end = r.points[r.points.length - 1] as Vec2;
    const it = spec.rivers.items.find((x) => x.id === r.id)!;
    if (it.outlet) {
      assert.equal(r.outlet, it.outlet.waterBody);
      const body = spec.waterBodies.find((b) => b.id === it.outlet!.waterBody)!;
      const d = ringDist(end, body.polygon);
      assert.ok(d <= tol, `${r.id}: outlet ${d.toFixed(1)} m from the ${body.id} shore (tolerance ${tol})`);
    } else {
      const d = coastDist(end);
      assert.ok(d <= tol, `${r.id}: outlet ${d.toFixed(1)} m from the coastline (tolerance ${tol})`);
    }
    assert.deepEqual(end, it.mouth, `${r.id}: course does not end at its authored mouth`);
    // The course stays on land before its mouth.
    for (const p of r.points.slice(0, -2)) assert.ok(inLand(p), `${r.id}: course leaves the land at (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
  }
  const chagres = l3.rivers.find((r) => r.id === 'rio-chagres')!;
  assert.equal(chagres.outlet, 'gatun-lake');
  assert.ok(ringDist(chagres.points[chagres.points.length - 1] as Vec2, lakeBody.polygon) <= tol);
  assert.ok(chagres.surface[chagres.surface.length - 1] === spec.canal.lakeLevel);
});

// Real mouth spacing on the Panama Bay shore: specs/map/refs/metrics.yaml `rivers-pacific.pacific_shore_mouths.gaps` (straight
// distance between neighbouring mouths, real metres). The 38 km Caimito-Curundu gap lies far west of the corridor and is left out;
// the rest span 1.4-12.2 km. Corridor compression is ~1:4 (specs/map/README.md), so the map band is [min, max] / 4.
const metrics = load(readFileSync(join(import.meta.dirname, '../specs/map/refs/metrics.yaml'), 'utf8')) as {
  rivers: { 'rivers-pacific': { pacific_shore_mouths: { gaps: { between: string[]; gap_m: number }[] } } };
};
const COMPRESSION = 4;
const realGaps = metrics.rivers['rivers-pacific'].pacific_shore_mouths.gaps.filter((g) => !g.between.includes('Río Caimito')).map((g) => g.gap_m);
const SPACING_BAND = { min: Math.min(...realGaps) / COMPRESSION, max: Math.max(...realGaps) / COMPRESSION };

test(`river mouth spacing on the Pacific shore within [${Math.round(SPACING_BAND.min)}, ${Math.round(SPACING_BAND.max)}] m (real gaps ${Math.min(...realGaps)}-${Math.max(...realGaps)} m / ${COMPRESSION}, metrics.yaml)`, () => {
  const pacific = l3.rivers.filter((r) => r.outlet === 'coast' && (r.points[r.points.length - 1] as Vec2).y < spec.bounds.height / 2).map((r) => r.points[r.points.length - 1] as Vec2).sort((a, b) => a.x - b.x);
  assert.ok(pacific.length >= 3, `only ${pacific.length} Pacific mouths`);
  for (let i = 1; i < pacific.length; i++) {
    const gap = Math.hypot((pacific[i] as Vec2).x - (pacific[i - 1] as Vec2).x, (pacific[i] as Vec2).y - (pacific[i - 1] as Vec2).y);
    console.log(`mouth gap ${i}: ${gap.toFixed(0)} m`);
    assert.ok(gap >= SPACING_BAND.min && gap <= SPACING_BAND.max, `mouth gap ${gap.toFixed(0)} m outside [${SPACING_BAND.min.toFixed(0)}, ${SPACING_BAND.max.toFixed(0)}]`);
  }
});

test('river tortuosity stays under the real maximum of the main rivers (metrics.yaml)', () => {
  const real = metrics.rivers as unknown as Record<string, { rivers: Record<string, { tortuosity: number }> }>;
  const all = Object.values(real).flatMap((s) => Object.values(s.rivers ?? {}).map((r) => r.tortuosity));
  const max = Math.max(...all);
  for (const r of l3.rivers) {
    console.log(`${r.id}: length ${r.length.toFixed(0)} m, tortuosity ${r.tortuosity.toFixed(2)}, width ${Math.max(...r.width).toFixed(1)} m, drainage ${(r.drainageKm2[r.drainageKm2.length - 1] as number).toFixed(2)} km2`);
    assert.ok(r.tortuosity >= 1 && r.tortuosity <= max, `${r.id}: tortuosity ${r.tortuosity.toFixed(2)} above the real max ${max}`);
  }
});

test('canal channel lies inside land except at its two sea ends', () => {
  const [s0, s1] = l3.canal.landRange;
  assert.ok(s0 > 0 && s1 < (l3.canal.arc[l3.canal.arc.length - 1] as number), 'both ends of the centreline reach the sea');
  assert.ok(l3.canal.reaches.length >= 3);
  const first = l3.canal.reaches[0] as WaterPolygon;
  const last = l3.canal.reaches[l3.canal.reaches.length - 1] as WaterPolygon;
  let outside = 0;
  for (const reach of l3.canal.reaches) {
    for (const p of reach.ring) {
      if (inLand(p)) continue;
      outside++;
      // A corner outside the land is a sea-end corner: within one channel width of the coast, and only on the first / last reach.
      assert.ok(coastDist(p) <= spec.canal.width, `reach ${reach.id}: corner (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) is ${coastDist(p).toFixed(0)} m into the sea`);
      assert.ok(reach === first || reach === last, `reach ${reach.id} has a corner in the sea but is not a sea-end reach`);
    }
  }
  console.log(`canal reach corners in the sea: ${outside}`);
  // Mid-channel samples are all on land.
  for (let s = s0 + 20; s < s1 - 20; s += 50) {
    let i = 0;
    while (i + 2 < l3.canal.centreline.length && (l3.canal.arc[i + 1] as number) < s) i++;
    const a = l3.canal.centreline[i] as Vec2;
    const b = l3.canal.centreline[i + 1] as Vec2;
    const t = (s - (l3.canal.arc[i] as number)) / ((l3.canal.arc[i + 1] as number) - (l3.canal.arc[i] as number));
    assert.ok(inLand({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), `centreline at arc ${s} is in the sea`);
  }
});

test('lake water level is lake_level; the basin floor lies below it and above sea level; the shore is above it', () => {
  const lakes = l3.water.filter((w) => w.kind === 'lake');
  assert.ok(lakes.length >= 2 && lakes.every((w) => w.level === spec.canal.lakeLevel && w.level === 12));
  const lake = lakes.find((w) => w.id === lakeBody.id)!;
  const islands = l3.islands;
  const bb = lakeBody.polygon.reduce((m, p) => ({ minX: Math.min(m.minX, p.x), maxX: Math.max(m.maxX, p.x), minY: Math.min(m.minY, p.y), maxY: Math.max(m.maxY, p.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  let floorMin = Infinity;
  let floorMax = -Infinity;
  let n = 0;
  let shoreMin = Infinity;
  let shoreAt = '';
  for (let y = bb.minY - 200; y <= bb.maxY + 200; y += 40) {
    for (let x = bb.minX - 200; x <= bb.maxX + 200; x += 40) {
      const p = { x, y };
      const h = terrain.heightAt(x, y);
      if (pointInPolygon(p, lake.ring)) {
        if (islands.some((i) => Math.hypot(i.x - x, i.y - y) <= i.radius * 1.6)) continue;
        // The surface is a 16 m grid: a sample within one cell of the shore interpolates the floor with the bank.
        if (ringDist(p, lake.ring) < spec.relief.grid.far.cell) continue;
        n++;
        floorMin = Math.min(floorMin, h);
        floorMax = Math.max(floorMax, h);
      } else if (ringDist(p, lake.ring) >= spec.relief.grid.far.cell && ringDist(p, lake.ring) <= 150 && inLand(p) && !lakes.some((w) => pointInPolygon(p, w.ring)) && !l3.canal.reaches.some((r) => pointInPolygon(p, r.ring))) {
        // Land around the lake (not the channel mouth): never lower than the water.
        if (h < shoreMin) { shoreMin = h; shoreAt = `${x},${y}`; }
      }
    }
  }
  console.log(`lake basin floor over ${n} samples: [${floorMin.toFixed(2)}, ${floorMax.toFixed(2)}] m, level 12, lowest shore ${shoreMin.toFixed(2)} m at ${shoreAt}`);
  assert.ok(floorMax < spec.canal.lakeLevel, `basin floor reaches ${floorMax.toFixed(2)} m, not below the lake level ${spec.canal.lakeLevel}`);
  assert.ok(floorMin > spec.canal.seaLevel, `basin floor falls to ${floorMin.toFixed(2)} m, not above sea level`);
  assert.ok(shoreMin >= spec.canal.lakeLevel, `shore ground at ${shoreMin.toFixed(2)} m is below the lake level (the lake would spill)`);
});

test('lake islands: seeded count, inside the lake, off the shipping channel, summits above the water', () => {
  assert.equal(l3.islands.length, lakeBody.islands!.count);
  for (const i of l3.islands) {
    assert.ok(pointInPolygon({ x: i.x, y: i.y }, lakeBody.polygon), `island at ${i.x.toFixed(0)},${i.y.toFixed(0)} is outside the lake`);
    assert.ok(ringDist({ x: i.x, y: i.y }, lakeBody.polygon) > i.radius * 1.6, 'island reaches the shore');
    const d = distanceToPolyline({ x: i.x, y: i.y }, l3.canal.centreline);
    assert.ok(d > half + i.radius * 1.6, `island at ${i.x.toFixed(0)},${i.y.toFixed(0)} is ${d.toFixed(0)} m from the shipping channel`);
    assert.ok(terrain.heightAt(i.x, i.y) > spec.canal.lakeLevel, `island summit ${terrain.heightAt(i.x, i.y).toFixed(2)} m is not above the water`);
  }
  const lake = l3.water.find((w) => w.id === lakeBody.id)!;
  assert.equal(lake.holes.length, l3.islands.length, 'every island is a hole of the lake surface');
});

/** Water cells at 10 m: the sea (outside geometry.land) plus every water polygon (islands excluded). */
function waterGrid(polys: readonly WaterPolygon[]): { cell: number; cols: number; rows: number; water: Uint8Array } {
  const cell = 10;
  const cols = spec.bounds.width / cell;
  const rows = spec.bounds.height / cell;
  const water = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (!inLand({ x: (i + 0.5) * cell, y: (j + 0.5) * cell })) water[j * cols + i] = 1;
  for (const w of polys) {
    const b = w.ring.reduce((m, p) => ({ minX: Math.min(m.minX, p.x), maxX: Math.max(m.maxX, p.x), minY: Math.min(m.minY, p.y), maxY: Math.max(m.maxY, p.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    for (let j = Math.max(0, Math.floor(b.minY / cell)); j <= Math.min(rows - 1, Math.floor(b.maxY / cell)); j++) {
      for (let i = Math.max(0, Math.floor(b.minX / cell)); i <= Math.min(cols - 1, Math.floor(b.maxX / cell)); i++) {
        const p = { x: (i + 0.5) * cell, y: (j + 0.5) * cell };
        if (pointInPolygon(p, w.ring) && !w.holes.some((h) => pointInPolygon(p, h))) water[j * cols + i] = 1;
      }
    }
  }
  return { cell, cols, rows, water };
}

function connected(g: { cell: number; cols: number; rows: number; water: Uint8Array }, a: Vec2, b: Vec2): boolean {
  const idx = (p: Vec2): number => Math.floor(p.y / g.cell) * g.cols + Math.floor(p.x / g.cell);
  const start = idx(a);
  const goal = idx(b);
  assert.ok(g.water[start] && g.water[goal], 'BFS endpoints must be water');
  const seen = new Uint8Array(g.water.length);
  const queue = [start];
  seen[start] = 1;
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q] as number;
    if (k === goal) return true;
    const i = k % g.cols;
    const j = (k - i) / g.cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue;
      const m = nj * g.cols + ni;
      if (g.water[m] && !seen[m]) {
        seen[m] = 1;
        queue.push(m);
      }
    }
  }
  return false;
}

test('bay to bay: BFS over water through the channel, the lake and the locks connects the Pacific and the Caribbean', () => {
  const pacific = { x: 1300, y: 100 };
  const caribbean = { x: 300, y: 7800 };
  assert.equal(connected(waterGrid([]), pacific, caribbean), false, 'with no inland water the two seas are separate (the BFS measures the canal)');
  assert.equal(connected(waterGrid(l3.water), pacific, caribbean), true, 'the canal does not link the bays');
  // Without the locks, or without the lake-level stretch of the channel, the bays are separate again.
  assert.equal(connected(waterGrid(l3.water.filter((w) => w.kind !== 'chamber')), pacific, caribbean), false, 'the bays are linked with no lock chambers');
  assert.equal(connected(waterGrid(l3.water.filter((w) => !(w.kind === 'canal' && w.level === spec.canal.lakeLevel))), pacific, caribbean), false, 'the bays are linked with no lake-level channel');
});

test('lock chambers are 305 x 34 m at their landmarks, aligned with the channel; step counts 2 and 3', () => {
  assert.deepEqual(l3.locks.map((l) => [l.id, l.steps]), [['miraflores', 2], ['gatun', 3]]);
  for (const lock of l3.locks) {
    const lk = spec.canal.locks.find((l) => l.id === lock.id)!;
    assert.deepEqual([...lock.chamber], [305, 34]);
    assert.equal(lock.chambers.length, lk.steps);
    const lm = landmark(lk.landmark);
    assert.ok(Math.min(...lock.chambers.map((c) => Math.hypot(c.center.x - lm.x, c.center.y - lm.y))) <= 305 / 2 + 1, `${lock.id}: no chamber at landmark ${lk.landmark}`);
    let prev = spec.canal.seaLevel;
    for (const c of lock.chambers) {
      const side = (i: number): number => Math.hypot((c.ring[(i + 1) % 4] as Vec2).x - (c.ring[i] as Vec2).x, (c.ring[(i + 1) % 4] as Vec2).y - (c.ring[i] as Vec2).y);
      assert.ok(Math.abs(side(0) - 305) < 1e-6 && Math.abs(side(1) - 34) < 1e-6, `${lock.id} chamber ${c.index}: ${side(0).toFixed(1)} x ${side(1).toFixed(1)} m, expected 305 x 34`);
      assert.equal(c.length, 305);
      assert.equal(c.width, 34);
      // Aligned: centre on the channel centreline (within the channel minus the chamber half width) and parallel to it.
      const dc = distanceToPolyline(c.center, l3.canal.centreline);
      assert.ok(dc <= half - 17, `${lock.id} chamber ${c.index}: centre ${dc.toFixed(0)} m off the channel axis`);
      for (const p of c.ring) assert.ok(distanceToPolyline(p, l3.canal.centreline) <= half, `${lock.id} chamber ${c.index}: corner outside the channel`);
      assert.ok(c.level > prev, `${lock.id} chamber ${c.index}: levels must rise from the sea side (${prev} -> ${c.level})`);
      prev = c.level;
      assert.ok(c.floor < c.level);
    }
    assert.equal(prev, spec.canal.lakeLevel, `${lock.id}: the last chamber meets the lake level`);
    // The flight is clear of the lake polygon (chambers are not inside the lake).
    for (const c of lock.chambers) assert.ok(!pointInPolygon(c.center, lakeBody.polygon), `${lock.id} chamber ${c.index} is inside the lake`);
  }
});

test('cable-bridge and arch-bridge sit on the channel', () => {
  for (const id of spec.canal.bridgeLandmarks) {
    const p = landmark(id);
    const d = distanceToPolyline(p, l3.canal.centreline);
    assert.ok(d <= half, `${id}: ${d.toFixed(0)} m from the centreline, outside the ${half} m half width`);
    assert.ok(l3.canal.reaches.some((r) => pointInPolygon(p, r.ring)), `${id} is not over a canal water polygon`);
  }
  assert.deepEqual([...spec.canal.bridgeLandmarks].sort(), ['arch-bridge', 'cable-bridge']);
  assert.ok(spec.landmarks.find((l) => l.id === 'gamboa'), 'gamboa landmark');
  // Gamboa sits on the east bank, not on the channel.
  const g = landmark('gamboa');
  const dg = distanceToPolyline(g, l3.canal.centreline);
  assert.ok(dg > half && dg < 3 * half, `gamboa is ${dg.toFixed(0)} m from the centreline: on the bank, not on a vertex or in the water`);
  const cl = l3.canal.centreline;
  assert.ok(cl.every((v) => Math.hypot(v.x - g.x, v.y - g.y) > half), 'gamboa is not on a canal vertex');
  assert.ok(g.x > 1300, 'gamboa is east of the centreline');
});

test('carving: river beds are cut below the ground, the channel and chambers sit at their levels, shoreline stays at sea level', () => {
  const l2 = layer2Relief(spec, {});
  const h0 = (x: number, y: number): number => {
    const g = l2.far;
    const fx = x / g.cell;
    const fy = y / g.cell;
    const i = Math.min(g.cols - 2, Math.floor(fx));
    const j = Math.min(g.rows - 2, Math.floor(fy));
    const tx = fx - i;
    const ty = fy - j;
    const d = g.data;
    const k = j * g.cols + i;
    return ((d[k] as number) * (1 - tx) + (d[k + 1] as number) * tx) * (1 - ty) + ((d[k + g.cols] as number) * (1 - tx) + (d[k + g.cols + 1] as number) * tx) * ty;
  };
  for (const r of l3.rivers) {
    const mid = Math.floor(r.points.length / 2);
    const p = r.points[mid] as Vec2;
    const bed = (r.surface[mid] as number) - (r.depth[mid] as number);
    assert.ok(Math.abs(terrain.heightAt(p.x, p.y) - bed) < 1.5 + 0.25 * r.width[mid]!, `${r.id}: terrain ${terrain.heightAt(p.x, p.y).toFixed(2)} at the river middle, bed ${bed.toFixed(2)}`);
    assert.ok(terrain.heightAt(p.x, p.y) < h0(p.x, p.y) + 0.3, `${r.id}: river not carved`);
  }
  // Chamber floors sit at their level minus the depth; the apron around them is flat at the wall top.
  for (const lock of l3.locks) {
    for (const c of lock.chambers) assert.ok(Math.abs(terrain.heightAt(c.center.x, c.center.y) - c.floor) < 1, `${lock.id} chamber ${c.index}: floor ${terrain.heightAt(c.center.x, c.center.y).toFixed(2)} vs ${c.floor}`);
  }
  // Channel in the lake-level reach: bed 8 m under the lake level.
  const lakeReach = l3.canal.reaches.find((r) => r.level === spec.canal.lakeLevel)!;
  assert.ok(lakeReach);
  const cable = landmark('cable-bridge');
  assert.ok(Math.abs(terrain.heightAt(cable.x, cable.y) - (spec.canal.lakeLevel - l3.canal.depth)) < 2, 'channel bed at the cable bridge');
  const arch = landmark('arch-bridge');
  assert.ok(terrain.heightAt(arch.x, arch.y) < spec.canal.seaLevel + 0.5, 'channel at the arch bridge is at sea level or below');
});

test('an existing street that crosses a river keeps its own level: no carve under the carriageway', () => {
  const edges = world.streets.graph.edges.filter((e) => e.cls !== 'frame' && e.width > 0);
  const nodes = world.streets.graph.nodes as { x: number; y: number }[];
  const l2 = layer2Relief(spec, {});
  const fine = l2.fine;
  const h0 = (x: number, y: number): number => {
    const fx = (x - fine.x0) / fine.cell;
    const fy = (y - fine.y0) / fine.cell;
    const i = Math.min(fine.cols - 2, Math.floor(fx));
    const j = Math.min(fine.rows - 2, Math.floor(fy));
    const tx = fx - i;
    const ty = fy - j;
    const k = j * fine.cols + i;
    const d = fine.data;
    return ((d[k] as number) * (1 - tx) + (d[k + 1] as number) * tx) * (1 - ty) + ((d[k + fine.cols] as number) * (1 - tx) + (d[k + fine.cols + 1] as number) * tx) * ty;
  };
  const onRoad = (p: Vec2): boolean => edges.some((e) => segDist(p, nodes[e.a] as Vec2, nodes[e.b] as Vec2) <= e.width / 2);
  const inFine = (p: Vec2): boolean => p.x > fine.x0 + 130 && p.y > fine.y0 + 130 && p.x < fine.x0 + (fine.cols - 1) * fine.cell - 130 && p.y < fine.y0 + (fine.rows - 1) * fine.cell - 130;
  let under = 0;
  let worstUnder = 0;
  let free = 0;
  let worstFree = 0;
  for (const r of l3.rivers) {
    // Dense samples along the river (every 4 m): on a carriageway versus on open ground.
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i] as Vec2;
      const b = r.points[i + 1] as Vec2;
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
      for (let s = 0; s < n; s++) {
        const p = { x: a.x + ((b.x - a.x) * s) / n, y: a.y + ((b.y - a.y) * s) / n };
        if (!inFine(p) || (r.depth[i] as number) < 1) continue;
        const dip = h0(p.x, p.y) - terrain.heightAt(p.x, p.y);
        if (onRoad(p)) {
          under++;
          worstUnder = Math.max(worstUnder, dip);
        } else {
          free++;
          worstFree = Math.max(worstFree, dip);
        }
      }
    }
  }
  console.log(`river samples under a carriageway: ${under} (deepest dip below H0 ${worstUnder.toFixed(2)} m); on open ground: ${free} (deepest ${worstFree.toFixed(2)} m)`);
  assert.ok(under > 0, 'the old street network crosses a river somewhere in the active area');
  assert.ok(worstFree > 1, 'rivers are carved on open ground (control)');
  assert.ok(worstUnder < 0.5 * worstFree && worstUnder < 1.5, `terrain dips ${worstUnder.toFixed(2)} m under a carriageway (open ground ${worstFree.toFixed(2)} m): the river was carved under the road`);
});
