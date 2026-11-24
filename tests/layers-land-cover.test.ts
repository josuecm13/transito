import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import { pointInPolygon, distanceToSegment } from '../src/world/geometry.ts';
import type { Vec2 } from '../src/world/vec.ts';
import { coverAt, densityAt, layer1LandCover } from '../src/world/layers/layer1-land-cover.ts';

const spec = parseWorldSpec(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
const t0 = performance.now();
const l1 = layer1LandCover(spec);
const buildMs = performance.now() - t0;
const lc = spec.landCover;
const cell = l1.cellFar;
const name = (k: number): string => l1.classes[l1.cover[k] as number] as string;
const center = (k: number): Vec2 => ({ x: ((k % l1.cols) + 0.5) * cell, y: (Math.floor(k / l1.cols) + 0.5) * cell });

/** Shore = geometry.land minus the map's west / east / north bounds edges (written out here, independent of the layer). */
const shore: [Vec2, Vec2][] = spec.land.flatMap((a, i): [Vec2, Vec2][] => {
  const b = spec.land[(i + 1) % spec.land.length]!;
  const onBounds = (a.x === b.x && (a.x === 0 || a.x === spec.bounds.width)) || (a.y === b.y && (a.y === 0 || a.y === spec.bounds.height));
  return onBounds ? [] : [[a, b]];
});
const coastDist = (p: Vec2): number => Math.min(...shore.map(([a, b]) => distanceToSegment(p, a, b)));
const inRect = (p: Vec2, r: { minX: number; minY: number; maxX: number; maxY: number }): boolean => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

test('land cover: the grid is the whole isthmus on the far grid and builds fast', () => {
  assert.equal(l1.cols * cell, spec.bounds.width);
  assert.equal(l1.rows * cell, spec.bounds.height);
  assert.equal(l1.cover.length, l1.cols * l1.rows);
  console.log(`layer 1 (${l1.cols} x ${l1.rows} cells of ${cell} m) built in ${buildMs.toFixed(0)} ms`);
  assert.ok(buildMs < 1500, `layer 1 took ${buildMs.toFixed(0)} ms`);
});

test('land cover: no class but water outside geometry.land, and no water inside it', () => {
  let bad = 0;
  let first = '';
  for (let k = 0; k < l1.cover.length; k++) {
    const land = pointInPolygon(center(k), spec.land);
    const isWater = name(k) === 'water';
    if (land === isWater) {
      bad++;
      if (!first) first = `${JSON.stringify(center(k))} is ${name(k)} but land=${land}`;
    }
  }
  assert.equal(bad, 0, `${bad} cells disagree with geometry.land, first: ${first}`);
});

test('land cover: mangrove only inside a listed tidal shore rect and within the band of the shore (and wherever both hold)', () => {
  const rects = lc.mangrove.shores.flatMap((id) => lc.tidalShores.filter((t) => t.id === id).map((t) => t.rect));
  assert.ok(rects.length === lc.mangrove.shores.length && rects.length > 0);
  let outside = 0;
  let missing = 0;
  let first = '';
  let count = 0;
  for (let k = 0; k < l1.cover.length; k++) {
    const p = center(k);
    const isMangrove = name(k) === 'mangrove';
    if (isMangrove) count++;
    const land = pointInPolygon(p, spec.land);
    const inBand = land && rects.some((r) => inRect(p, r)) && coastDist(p) <= lc.mangrove.band;
    if (isMangrove && !inBand) {
      outside++;
      if (!first) first = `mangrove at ${JSON.stringify(p)} (coast ${coastDist(p).toFixed(0)} m, band ${lc.mangrove.band})`;
    }
    // Mangrove yields only to nothing: inside the band it is always mangrove (priority over settlements and reclaimed land).
    if (inBand && !isMangrove) missing++;
  }
  assert.ok(count > 100, `only ${count} mangrove cells`);
  assert.equal(outside, 0, `${outside} mangrove cells outside the tidal band, first: ${first}`);
  assert.equal(missing, 0, `${missing} cells inside the tidal band are not mangrove`);
});

test('land cover: class shares inside the planned bands of world.yaml (land_cover.shares)', () => {
  let land = 0;
  const n: Record<string, number> = {};
  for (let k = 0; k < l1.cover.length; k++) {
    const c = name(k);
    n[c] = (n[c] ?? 0) + 1;
    if (c !== 'water') land++;
  }
  const share = (c: string): number => (n[c] ?? 0) / land;
  const report = l1.classes.map((c) => `${c}=${(share(c) * 100).toFixed(1)}%`).join(' ');
  console.log(`land cover shares of land (${(land * cell * cell / 1e6).toFixed(1)} km2): ${report}`);
  assert.ok(share('urban_prior') >= lc.shares.urban[0] && share('urban_prior') <= lc.shares.urban[1], `urban share ${share('urban_prior').toFixed(3)} outside [${lc.shares.urban}]`);
  assert.ok(share('mangrove') >= lc.shares.wetland[0] && share('mangrove') <= lc.shares.wetland[1], `wetland share ${share('mangrove').toFixed(3)} outside [${lc.shares.wetland}]`);
  assert.ok(share('forest') > 0.5, `jungle share ${share('forest').toFixed(3)} is not the majority class`);
  assert.ok((n.clearing ?? 0) > 0 && (n.grass ?? 0) > 0 && (n.park_reclaimed ?? 0) > 0, 'clearing, grass and park_reclaimed all appear');
});

test('land cover: settlement centres are urban_prior, reclaimed land is park_reclaimed, density follows the forest noise', () => {
  for (const s of lc.settlements) assert.equal(coverAt(l1, s.at.x, s.at.y), 'urban_prior', s.id);
  const reclaimed = spec.relief.flatten.filter((z) => z.cap !== undefined);
  assert.ok(reclaimed.length > 0);
  for (const z of reclaimed) {
    let inside = 0;
    for (let k = 0; k < l1.cover.length; k++) {
      const c = name(k);
      if (inRect(center(k), z.rect) && c !== 'water' && c !== 'mangrove' && c !== 'urban_prior') {
        assert.equal(c, 'park_reclaimed', `reclaimed land ${z.id} at ${JSON.stringify(center(k))}`);
        inside++;
      }
    }
    assert.ok(inside > 100, `reclaimed land ${z.id} has ${inside} park_reclaimed cells`);
  }
  assert.equal(coverAt(l1, -10, 100), 'water');
  assert.equal(coverAt(l1, 3000, 500), 'water');
  let forestDensity = 0;
  let forest = 0;
  for (let k = 0; k < l1.cover.length; k++) {
    if (name(k) === 'forest') {
      forestDensity += l1.density[k] as number;
      forest++;
      assert.ok((l1.density[k] as number) / 255 >= lc.forest.clearingBelow, 'forest is above the clearing threshold');
    }
  }
  assert.ok(Math.abs(forestDensity / forest / 255 - lc.forest.density) < 0.15, 'mean forest density stays near land_cover.forest.density');
  assert.ok(densityAt(l1, 3000, 4000) > 0);
});

test('land cover: deterministic from the seed, and a different seed gives a different field', () => {
  const again = layer1LandCover(spec);
  assert.deepEqual(again, l1);
  const other = layer1LandCover({ ...spec, landCover: { ...spec.landCover, seed: spec.landCover.seed + 1 } });
  assert.notDeepEqual(other.density, l1.density);
});
