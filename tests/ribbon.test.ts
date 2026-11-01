import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ribbon } from '../src/world/ribbon.ts';
import type { Vec2 } from '../src/world/vec.ts';

function signedAreas(positions: Vec2[], indices: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = positions[indices[i] as number] as Vec2;
    const b = positions[indices[i + 1] as number] as Vec2;
    const c = positions[indices[i + 2] as number] as Vec2;
    out.push(((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2);
  }
  return out;
}

test('straight 100 m ribbon with half widths 7/7: 4 points, 2 triangles, 1400 m2', () => {
  const r = ribbon([{ x: 0, y: 0 }, { x: 0, y: 100 }], 7, 7);
  assert.equal(r.positions.length, 4);
  assert.equal(r.indices.length, 6);
  const areas = signedAreas(r.positions, r.indices);
  assert.ok(Math.abs(areas.reduce((s, a) => s + Math.abs(a), 0) - 1400) < 1e-9);
});

test('asymmetric half widths change the area', () => {
  const r = ribbon([{ x: 0, y: 0 }, { x: 100, y: 0 }], 3, 1);
  const total = signedAreas(r.positions, r.indices).reduce((s, a) => s + a, 0);
  assert.ok(Math.abs(total - 400) < 1e-9);
});

test('all triangles wind the same way, including on a bent line', () => {
  const line = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 40, y: 80 }, { x: 90, y: 80 }];
  const r = ribbon(line, 5, 5);
  assert.equal(r.indices.length, 18);
  const areas = signedAreas(r.positions, r.indices);
  assert.ok(areas.every((a) => a > 0), `areas: ${areas.join(',')}`);
});
