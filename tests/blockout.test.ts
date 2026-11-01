import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingCorners } from '../src/world/blockout.ts';

const close = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `${a.x},${a.y} vs ${b.x},${b.y}`);

test('buildingCorners: counter-clockwise from (-w/2, -d/2), rotated about the center', () => {
  const flat = buildingCorners({ center: { x: 10, y: 20 }, width: 4, depth: 2, angle: 0 });
  [{ x: 8, y: 19 }, { x: 12, y: 19 }, { x: 12, y: 21 }, { x: 8, y: 21 }].forEach((p, i) => close(flat[i]!, p));
  const turned = buildingCorners({ center: { x: 0, y: 0 }, width: 4, depth: 2, angle: Math.PI / 2 });
  [{ x: 1, y: -2 }, { x: 1, y: 2 }, { x: -1, y: 2 }, { x: -1, y: -2 }].forEach((p, i) => close(turned[i]!, p));
});
