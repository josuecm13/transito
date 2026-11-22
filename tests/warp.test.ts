/**
 * Dev-time warp (tools/warp-lib.ts): fold check, exactness at anchors, containment.
 * The fold guard was mutation-checked (orientation comparison disabled -> the swapped-pair test went red).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { Anchor } from '../tools/warp-lib.ts';
import { buildWarp, delaunay, flippedTriples, foldCheck, fromMetres, outsideLand, toMetres } from '../tools/warp-lib.ts';

/** Real positions on a lon/lat grid; map = real metres scaled (x 1:50, y 1:10) and shifted: consistent by construction. */
const mk = (id: string, e: number, n: number): Anchor => {
  const [lon, lat] = fromMetres(e, n);
  return { id, real: [lon, lat], map: [3000 + e / 50, 2000 + n / 10] };
};
const consistent = (): Anchor[] => [
  mk('sw', -9000, -6000), mk('se', 9000, -5000), mk('ne', 8000, 7000), mk('nw', -8000, 6000), mk('mid', 500, 300), mk('n', 0, 7500),
];

test('fold check passes on a consistent synthetic anchor set', () => {
  const r = foldCheck(consistent());
  assert.equal(r.folded.length, 0, JSON.stringify(r.folded));
  assert.ok(r.ok);
  assert.ok(r.triangles >= 4);
  assert.equal(flippedTriples(consistent()).flipped.length, 0);
});

test('fold check reports a fold when one pair of map positions is swapped', () => {
  const a = consistent();
  const mid = a.find((x) => x.id === 'mid')!, sw = a.find((x) => x.id === 'sw')!;
  [mid.map, sw.map] = [sw.map, mid.map];
  const r = foldCheck(a);
  assert.ok(r.folded.length > 0, 'a swapped pair must fold');
  assert.ok(!r.ok);
  const offenders = r.anchorFolds.map((x) => x.id);
  assert.ok(offenders.includes('mid') || offenders.includes('sw'), `offenders: ${offenders}`);
  assert.ok(flippedTriples(a).flipped.length > 0);
});

test('delaunay covers the hull: triangle areas sum to the convex-hull area of a square', () => {
  const t = delaunay([[0, 0], [100, 0], [100, 100], [0, 100], [50, 40]] as [number, number][]);
  let area = 0;
  const p: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100], [50, 40]];
  for (const [i, j, k] of t) {
    area += Math.abs((p[j]![0] - p[i]![0]) * (p[k]![1] - p[i]![1]) - (p[j]![1] - p[i]![1]) * (p[k]![0] - p[i]![0])) / 2;
  }
  assert.equal(t.length, 4);
  assert.ok(Math.abs(area - 10000) < 1e-6);
});

test('warp maps every anchor onto its map position (<= 0.01 m)', () => {
  const a = consistent();
  const w = buildWarp(a);
  for (const x of a) {
    const [px, py] = w.apply(x.real[0], x.real[1]);
    assert.ok(Math.hypot(px - x.map[0], py - x.map[1]) <= 0.01, `${x.id}: ${px},${py} vs ${x.map}`);
  }
});

test('warp keeps a point inside a triangle inside the image triangle', () => {
  const a = consistent();
  const w = buildWarp(a);
  for (const [i, j, k] of w.tris) {
    for (const [u, v] of [[0.2, 0.3], [0.6, 0.1], [0.1, 0.8], [1 / 3, 1 / 3]] as [number, number][]) {
      const P = [i, j, k].map((n) => toMetres(a[n]!.real[0], a[n]!.real[1]));
      const e = P[0]![0] + u * (P[1]![0] - P[0]![0]) + v * (P[2]![0] - P[0]![0]);
      const n = P[0]![1] + u * (P[1]![1] - P[0]![1]) + v * (P[2]![1] - P[0]![1]);
      const [lon, lat] = fromMetres(e, n);
      const [x, y] = w.apply(lon, lat);
      const Q = [i, j, k].map((m) => a[m]!.map);
      const ex = Q[0]![0] + u * (Q[1]![0] - Q[0]![0]) + v * (Q[2]![0] - Q[0]![0]);
      const ey = Q[0]![1] + u * (Q[1]![1] - Q[0]![1]) + v * (Q[2]![1] - Q[0]![1]);
      assert.ok(Math.hypot(x - ex, y - ey) < 1e-6, `barycentric image mismatch ${x},${y} vs ${ex},${ey}`);
    }
  }
});

test('outsideLand reports the fraction and the worst distance', () => {
  const sq: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const r = outsideLand([[50, 50], [150, 50], [50, 50], [50, -30]], sq);
  assert.equal(r.outside, 2);
  assert.equal(r.fraction, 0.5);
  assert.equal(r.maxDistance, 50);
});

test('anchors.yaml: ids unique, real inside the isthmus, map inside the 6 x 8 km box', () => {
  const doc = load(readFileSync(join(import.meta.dirname, '../specs/map/anchors.yaml'), 'utf8')) as { anchors: Anchor[] };
  const ids = new Set(doc.anchors.map((x) => x.id));
  assert.equal(ids.size, doc.anchors.length);
  assert.ok(doc.anchors.length >= 7);
  for (const x of doc.anchors) {
    assert.ok(x.real[0] > -80.1 && x.real[0] < -79.3 && x.real[1] > 8.85 && x.real[1] < 9.45, x.id);
    assert.ok(x.map[0] >= 0 && x.map[0] <= 6000 && x.map[1] >= 0 && x.map[1] <= 8000, x.id);
  }
});
