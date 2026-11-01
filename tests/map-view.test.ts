import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCenter,
  fitBounds,
  niceScaleLength,
  pan,
  placeLabels,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../src/sim/map-view.ts';

const vp = { w: 1000, h: 600 };
const view = { center: { x: 500, y: 300 }, metersPerPx: 2 };
const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const box = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });

test('round trip world -> screen -> world', () => {
  for (const p of [{ x: 123.4, y: 987.6 }, { x: -50, y: 4000 }, view.center]) {
    const q = screenToWorld(view, worldToScreen(view, p, vp), vp);
    near(q.x, p.x);
    near(q.y, p.y);
  }
});

test('north is up, east is right, center maps to the viewport center', () => {
  const c = worldToScreen(view, view.center, vp);
  assert.deepEqual(c, { x: 500, y: 300 });
  assert.ok(worldToScreen(view, { x: 500, y: 400 }, vp).y < c.y, 'north is up');
  assert.ok(worldToScreen(view, { x: 600, y: 300 }, vp).x > c.x, 'east is right');
});

test('fitBounds shows all four corners inside the padded viewport', () => {
  const b = { minX: 0, minY: 0, maxX: 6000, maxY: 8000 };
  const pad = 40;
  const v = fitBounds(b, vp, pad);
  for (const x of [b.minX, b.maxX]) {
    for (const y of [b.minY, b.maxY]) {
      const s = worldToScreen(v, { x, y }, vp);
      const ok = s.x >= pad - 1e-9 && s.x <= vp.w - pad + 1e-9 && s.y >= pad - 1e-9 && s.y <= vp.h - pad + 1e-9;
      assert.ok(ok, `corner ${x},${y} -> ${s.x},${s.y}`);
    }
  }
});

test('zoomAt keeps the world point under the cursor fixed', () => {
  for (const cursor of [{ x: 820, y: 130 }, { x: 10, y: 590 }]) {
    for (const f of [1.7, 0.4]) {
      const before = screenToWorld(view, cursor, vp);
      const z = zoomAt(view, cursor, f, vp, { min: 0.5, max: 50 });
      const after = screenToWorld(z, cursor, vp);
      near(after.x, before.x);
      near(after.y, before.y);
      near(z.metersPerPx, 2 / f);
    }
  }
});

test('zoomAt clamps metersPerPx and still keeps the cursor point fixed', () => {
  const lim = { min: 0.5, max: 4 };
  const cursor = { x: 900, y: 50 };
  const zin = zoomAt(view, cursor, 1000, vp, lim);
  assert.equal(zin.metersPerPx, 0.5);
  const zout = zoomAt(view, cursor, 0.001, vp, lim);
  assert.equal(zout.metersPerPx, 4);
  const before = screenToWorld(view, cursor, vp);
  near(screenToWorld(zin, cursor, vp).x, before.x);
  near(screenToWorld(zin, cursor, vp).y, before.y);
});

test('pan follows the pointer and clampCenter limits the center', () => {
  assert.deepEqual(pan(view, 10, 10).center, { x: 480, y: 320 });
  const c = clampCenter({ center: { x: -5, y: 9999 }, metersPerPx: 1 }, box(0, 0, 100, 200));
  assert.deepEqual(c.center, { x: 0, y: 200 });
  const inside = clampCenter(view, box(0, 0, 1000, 1000));
  assert.deepEqual(inside.center, view.center);
});

test('niceScaleLength picks the largest 1-2-5 step that fits', () => {
  assert.equal(niceScaleLength(130), 100);
  assert.equal(niceScaleLength(260), 200);
  assert.equal(niceScaleLength(999), 500);
  assert.equal(niceScaleLength(1000), 1000);
  assert.equal(niceScaleLength(7.3), 5);
});

test('placeLabels: priority wins, fallback boxes are used, viewport and reserved boxes are respected', () => {
  const res = placeLabels(
    [
      { priority: 1, boxes: [box(0, 0, 50, 10), box(0, 20, 50, 30)] }, // loses first box, takes second
      { priority: 5, boxes: [box(10, 0, 60, 10)] },
      { priority: 9, boxes: [box(990, 0, 1100, 10)] }, // off-screen
      { priority: 9, boxes: [box(300, 300, 320, 320)] }, // reserved
    ],
    [box(310, 310, 400, 400)],
    vp,
  );
  assert.deepEqual(res, [1, 0, -1, -1]);
});
