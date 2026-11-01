import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtLines, courtRect } from '../src/world/court-layout.ts';
import type { Poly } from '../src/world/streets/poly.ts';
import { ringArea, ringInsidePoly } from '../src/world/streets/poly.ts';
import type { Vec2 } from '../src/world/vec.ts';

const rect = (w: number, h: number, angleDeg = 0, at: Vec2 = { x: 0, y: 0 }): Poly => {
  const t = (angleDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return { outer: pts.map((p) => ({ x: at.x + p.x * c - p.y * s, y: at.y + p.x * s + p.y * c })), holes: [] };
};
const side = (p: Vec2, q: Vec2): number => Math.hypot(q.x - p.x, q.y - p.y);
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('a roomy part gets a full 40 x 20 court, counter-clockwise, inside with margin', () => {
  const part = rect(100, 80);
  const r = courtRect(part, 1.5);
  assert.ok(r);
  near(side(r[0] as Vec2, r[1] as Vec2), 40);
  near(side(r[1] as Vec2, r[2] as Vec2), 20);
  assert.ok(ringArea(r) > 0);
  assert.ok(ringInsidePoly(r, part, 1.5));
});

test('the court follows the part orientation and shrinks to fit a small part', () => {
  const part = rect(30, 15, 30, { x: 500, y: 200 });
  const r = courtRect(part, 1.5);
  assert.ok(r);
  near(side(r[0] as Vec2, r[1] as Vec2), 27);
  near(side(r[1] as Vec2, r[2] as Vec2), 12);
  const a = r[0] as Vec2;
  const b = r[1] as Vec2;
  const dir = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
  assert.ok(Math.abs(((dir - 30 + 540) % 180) - 0) < 1e-6 || Math.abs(((dir - 30 + 540) % 180) - 180) < 1e-6, `dir ${dir}`);
  assert.ok(ringInsidePoly(r, part, 1.5 - 1e-6));
});

test('an L-shaped part (box centre and centroid both outside): no court rather than one that pokes out', () => {
  const part: Poly = {
    outer: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 14 },
      { x: 14, y: 14 },
      { x: 14, y: 60 },
      { x: 0, y: 60 },
    ],
    holes: [],
  };
  assert.equal(courtRect(part, 1), undefined);
  // A fat L whose centroid is inside does get a court, inside the part.
  const fat: Poly = { outer: part.outer.map((p) => ({ x: p.x, y: p.y === 14 ? 40 : p.y })).map((p) => ({ x: p.x === 14 ? 40 : p.x, y: p.y })), holes: [] };
  const r = courtRect(fat, 1);
  assert.ok(r);
  assert.ok(ringInsidePoly(r, fat, 1));
});

test('no court in a part narrower than the margins', () => {
  assert.equal(courtRect(rect(2.5, 40), 1.5), undefined);
  assert.equal(courtRect({ outer: [], holes: [] }), undefined);
});

test('court lines: border strip plus the halfway line', () => {
  const r = courtRect(rect(100, 80), 1.5) as Vec2[];
  const s = courtLines(r, 0.5);
  let area = 0;
  for (let i = 0; i < s.indices.length; i += 3) {
    const p = (k: number): Vec2 => ({ x: s.positions[2 * (s.indices[i + k] as number)] as number, y: s.positions[2 * (s.indices[i + k] as number) + 1] as number });
    const a = p(0);
    const b = p(1);
    const c = p(2);
    const cr = ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    assert.ok(cr > 0);
    area += cr;
  }
  near(area, 40 * 20 - 39 * 19 + 20 * 0.5);
});
