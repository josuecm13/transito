import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clipPolylineToRect,
  distanceToPolyline,
  distanceToSegment,
  offsetPolyline,
  pointInPolygon,
  polylineLength,
  polylineXAtY,
  rotate,
  segmentsOfPolygon,
} from '../src/world/geometry.ts';

const v = (x: number, y: number) => ({ x, y });
const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test('pointInPolygon: square, concave U', () => {
  const sq = [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];
  assert.equal(pointInPolygon(v(5, 5), sq), true);
  assert.equal(pointInPolygon(v(15, 5), sq), false);
  const u = [v(0, 0), v(9, 0), v(9, 9), v(6, 9), v(6, 3), v(3, 3), v(3, 9), v(0, 9)];
  assert.equal(pointInPolygon(v(1, 5), u), true);
  assert.equal(pointInPolygon(v(4.5, 6), u), false); // inside the notch
  assert.equal(pointInPolygon(v(4.5, 1), u), true);
});

test('distanceToSegment / polyline / length / segments / rotate', () => {
  near(distanceToSegment(v(5, 3), v(0, 0), v(10, 0)), 3);
  near(distanceToSegment(v(-3, 4), v(0, 0), v(10, 0)), 5);
  near(distanceToPolyline(v(5, 7), [v(0, 0), v(10, 0), v(10, 10)]), 5);
  near(polylineLength([v(0, 0), v(3, 4), v(3, 10)]), 11);
  assert.equal(segmentsOfPolygon([v(0, 0), v(1, 0), v(1, 1)]).length, 3);
  const r = rotate(v(1, 0), Math.PI / 2, v(0, 0));
  near(r.x, 0);
  near(r.y, 1);
});

test('polylineXAtY', () => {
  const line = [v(0, 10), v(10, 0)];
  near(polylineXAtY(line, 5) as number, 5);
  assert.equal(polylineXAtY(line, 11), undefined);
});

test('clipPolylineToRect: inside, crossing, outside, two entries', () => {
  const inside = [v(1, 1), v(5, 5), v(9, 2)];
  assert.deepEqual(clipPolylineToRect(inside, rect), [inside]);

  assert.deepEqual(clipPolylineToRect([v(-5, 5), v(15, 5)], rect), [[v(0, 5), v(10, 5)]]);
  assert.deepEqual(clipPolylineToRect([v(-5, -5), v(-1, 20)], rect), []);

  const twice = [v(5, 5), v(5, 15), v(15, 15), v(15, 5), v(8, 5)];
  const pieces = clipPolylineToRect(twice, rect);
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces[0], [v(5, 5), v(5, 10)]);
  assert.deepEqual(pieces[1], [v(10, 5), v(8, 5)]);

  // contiguous pieces merge into one polyline
  assert.equal(clipPolylineToRect([v(-5, 5), v(5, 5), v(5, 8), v(20, 8)], rect).length, 1);
});

test('offsetPolyline: straight line is parallel at distance d, left positive', () => {
  const line = [v(0, 0), v(10, 0), v(20, 0)];
  const left = offsetPolyline(line, 3);
  for (const p of left) near(p.y, 3);
  const right = offsetPolyline(line, -3);
  for (const p of right) near(p.y, -3);
  near(left[0]!.x, 0);
});

test('offsetPolyline: corners do not spike past the miter clamp', () => {
  const rightAngle = offsetPolyline([v(0, 0), v(10, 0), v(10, 10)], 2);
  // outer/inner corner of a right angle sits at sqrt(2)*d from the vertex
  near(Math.hypot(rightAngle[1]!.x - 10, rightAngle[1]!.y - 0), 2 * Math.SQRT2);
  const sharp = [v(0, 0), v(10, 0), v(0, 0.5)];
  const out = offsetPolyline(sharp, 1);
  assert.ok(Math.hypot(out[1]!.x - 10, out[1]!.y) <= 2 + 1e-9);
});
