import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampToCircle, headingToMinimapAngle, worldToMinimap } from '../src/sim/minimap.ts';
import { yawFacing } from '../src/sim/locomotion.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const C = { x: 1000, y: 500 };

test('center maps to the middle of the minimap', () => {
  const p = worldToMinimap(C, C, 1.5, 200);
  near(p.x, 100);
  near(p.y, 100);
});

test('north of center has a smaller y', () => {
  const p = worldToMinimap({ x: C.x, y: C.y + 30 }, C, 1.5, 200);
  assert.ok(p.y < 100);
  near(p.y, 80);
  near(p.x, 100);
});

test('east of center has a larger x', () => {
  const p = worldToMinimap({ x: C.x + 30, y: C.y }, C, 1.5, 200);
  assert.ok(p.x > 100);
  near(p.x, 120);
});

test('point inside the circle is not clamped', () => {
  const r = clampToCircle({ x: 120, y: 90 }, 200, 8);
  assert.equal(r.clamped, false);
  near(r.x, 120);
  near(r.y, 90);
});

test('far point due west clamps to x = margin, y = center', () => {
  const r = clampToCircle({ x: -500, y: 100 }, 200, 8);
  assert.equal(r.clamped, true);
  near(r.x, 8);
  near(r.y, 100);
});

test('far diagonal point keeps its bearing and lands on the circle', () => {
  const r = clampToCircle({ x: 100 + 400, y: 100 + 300 }, 200, 10);
  assert.equal(r.clamped, true);
  near(Math.hypot(r.x - 100, r.y - 100), 90);
  near((r.y - 100) / (r.x - 100), 300 / 400);
  assert.ok(r.x > 100 && r.y > 100);
});

test('heading: facing north -> 0, east -> +PI/2 (clockwise), derived from yawFacing', () => {
  near(headingToMinimapAngle(yawFacing(0, -1)), 0);
  near(headingToMinimapAngle(yawFacing(1, 0)), Math.PI / 2);
  near(headingToMinimapAngle(yawFacing(0, 1)), Math.PI);
  near(headingToMinimapAngle(yawFacing(-1, 0)), -Math.PI / 2);
});
