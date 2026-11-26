import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_RASTER_CAP_BYTES, MAP_TIERS, mapTierAt, mapTierRadiiM, rasterBytes } from '../src/sim/map-view.ts';

const ZOOMS = [0.5, 1, 4, 6, 24];
const R0 = (mpp: number): number => 420 * mpp; // literal on purpose: the guard must not read the table it protects

test('monotonic: further never gives a sharper tier or less blur', () => {
  for (const mpp of ZOOMS) {
    let prevTier = 0;
    let prevBlur = 0;
    for (let d = 0; d <= R0(mpp) * 12; d += R0(mpp) / 50) {
      const { tier, blurPx } = mapTierAt(d, mpp);
      assert.ok(tier >= prevTier, `tier went back at d=${d} mpp=${mpp}`);
      assert.ok(blurPx >= prevBlur - 1e-9, `blur shrank at d=${d} mpp=${mpp}`);
      prevTier = tier;
      prevBlur = blurPx;
    }
  }
});

test('boundaries: M0 up to r0, M1 up to 3 r0, M2 beyond 9 r0 (literal)', () => {
  for (const mpp of ZOOMS) {
    const r0 = R0(mpp);
    assert.equal(mapTierAt(r0, mpp).tier, 0);
    assert.equal(mapTierAt(r0 + 0.01 * mpp, mpp).tier, 1);
    assert.equal(mapTierAt(3 * r0, mpp).tier, 1);
    assert.equal(mapTierAt(3 * r0 + 0.01 * mpp, mpp).tier, 2);
    assert.equal(mapTierAt(9 * r0 * 2, mpp).tier, 2);
  }
  assert.ok(MAP_TIERS.m1Factor < MAP_TIERS.m2Factor, 'thresholds ordered');
});

test('M0 inside the radius, with no blur, and the player spot is sharp', () => {
  for (const mpp of ZOOMS) {
    assert.deepEqual(mapTierAt(0, mpp), { tier: 0, blurPx: 0 });
    assert.deepEqual(mapTierAt(R0(mpp) * 0.99, mpp), { tier: 0, blurPx: 0 });
  }
  assert.deepEqual(mapTierAt(10, 1, 20), { tier: 0, blurPx: 0 });
  assert.equal(mapTierAt(30, 1, 20).tier, 1);
});

test('blur is never negative and is capped at the M2 blur (also for odd inputs)', () => {
  for (const d of [-500, -1, 0, 1, 1e3, 1e6, 1e12]) {
    for (const mpp of ZOOMS) {
      const { blurPx } = mapTierAt(d, mpp);
      assert.ok(blurPx >= 0 && blurPx <= 4 + 1e-9, `blur ${blurPx}`);
    }
  }
  assert.equal(mapTierAt(1e9, 1).blurPx, 4);
  assert.ok(mapTierAt(2 * R0(1), 1).blurPx > 0);
  assert.equal(mapTierAt(3 * R0(1), 1).blurPx, 1.5);
});

test('symmetric in x/y: the distance is all that matters, and a negative one is its mirror', () => {
  for (const [dx, dy] of [[300, 0], [0, 300], [-300, 0], [0, -300], [3000, 40]] as const) {
    const a = mapTierAt(Math.hypot(dx, dy), 2);
    const b = mapTierAt(Math.hypot(dy, dx), 2);
    assert.deepEqual(a, b);
  }
  assert.deepEqual(mapTierAt(-900, 2), mapTierAt(900, 2));
});

test('radii scale with the zoom and are ordered', () => {
  const a = mapTierRadiiM(1);
  const b = mapTierRadiiM(2);
  assert.equal(b.r0, 2 * a.r0);
  assert.ok(a.r0 < a.r1 && a.r1 < a.r2);
});

test('raster bytes: M1 + M2 of the 6000 x 8000 m isthmus, plus one or two M0 (doc 8.5), fit the cap', () => {
  const m1 = rasterBytes(6000, 8000, MAP_TIERS.m1.metersPerPx);
  const m2 = rasterBytes(6000, 8000, MAP_TIERS.m2.metersPerPx);
  assert.equal(m1, 1000 * 1334 * 4);
  assert.equal(m2, 250 * 334 * 4);
  const m0 = rasterBytes(2409 + 200, 2958 + 200, MAP_TIERS.m0.metersPerPx); // Act 1 rect + margin: 2609 x 3158 px
  assert.equal(m0, 2609 * 3158 * 4);
  assert.ok(m0 + m1 + m2 <= MAP_RASTER_CAP_BYTES, 'one M0');
  assert.ok(2 * m0 + m1 + m2 <= MAP_RASTER_CAP_BYTES, 'two M0 (active + prefetch)');
  assert.ok(rasterBytes(2609, 3158, 0.25) + m1 + m2 > MAP_RASTER_CAP_BYTES, 'a 0.25 m/px M0 must be refused');
});
