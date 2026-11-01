import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Basis } from '../src/world/streets/tensor-field.ts';
import { alignSegments, createTensorField, sampleTensorField } from '../src/world/streets/tensor-field.ts';
import { simplify, traceStreamline, SampleIndex, enforceVertexGap } from '../src/world/streets/streamlines.ts';

const v = (x: number, y: number) => ({ x, y });
const angleOf = (d: { x: number; y: number }) => {
  let a = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  if (a < 0) a += 180;
  if (a >= 180) a -= 180;
  return a;
};
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} !~ ${b}`);

test('grid basis: major along the angle, minor at +90°', () => {
  const f = createTensorField([{ kind: 'grid', theta: (30 * Math.PI) / 180, weight: 1 }]);
  near(angleOf(f.direction(v(5, 5), 'major')!), 30);
  near(angleOf(f.direction(v(5, 5), 'minor')!), 120);
});

test('radial basis: major tangent to rings, minor along spokes', () => {
  const f = createTensorField([{ kind: 'radial', center: v(0, 0), weight: 1, decay: 500 }]);
  near(angleOf(f.direction(v(100, 0), 'major')!), 90);
  near(angleOf(f.direction(v(100, 0), 'minor')!), 0);
  near(angleOf(f.direction(v(100, 100), 'minor')!), 45);
});

test('perpendicular line basis cancels a grid on a band unless aligned (alignSegments)', () => {
  const grid: Basis = { kind: 'grid', theta: 0, weight: 1 };
  const segments: [{ x: number; y: number }, { x: number; y: number }][] = [[v(0, -500), v(0, 500)]];
  const naive = createTensorField([grid, { kind: 'polyline', segments, weight: 2, decay: 60 }]);
  const flips = alignSegments(segments, createTensorField([grid]));
  assert.deepEqual(flips, [true], 'vertical line beside a 0° grid aligns with the minor family');
  const aligned = createTensorField([grid, { kind: 'polyline', segments, weight: 2, decay: 60, flips }]);
  let naiveMin = Infinity;
  let alignedMin = Infinity;
  for (let x = 1; x <= 300; x += 1) {
    const tn = naive.tensor(v(x, 0));
    const ta = aligned.tensor(v(x, 0));
    naiveMin = Math.min(naiveMin, Math.hypot(tn.a, tn.b));
    alignedMin = Math.min(alignedMin, Math.hypot(ta.a, ta.b));
  }
  assert.ok(naiveMin < 0.02, `naive field degenerates near the line (min |T| ${naiveMin})`);
  assert.ok(alignedMin > 0.99, `aligned field never degenerates (min |T| ${alignedMin})`);
  // Next to the line the minor family runs along it (vertical); far away the grid rules.
  near(angleOf(aligned.direction(v(5, 0), 'minor')!), 90, 1e-3);
  near(angleOf(aligned.direction(v(290, 0), 'major')!), 0, 1e-3);
});

test('sampled field matches the exact field', () => {
  const exact = createTensorField([
    { kind: 'grid', theta: 0.3, weight: 1 },
    { kind: 'radial', center: v(150, 120), weight: 1, decay: 200 },
  ]);
  const sampled = sampleTensorField(exact, { minX: 0, minY: 0, maxX: 400, maxY: 400 }, 5);
  for (const p of [v(10, 10), v(203, 77), v(333, 391)]) {
    const a = exact.tensor(p);
    const b = sampled.tensor(p);
    assert.ok(Math.hypot(a.a - b.a, a.b - b.b) < 0.01, `${p.x},${p.y}`);
  }
});

test('streamline: follows a grid, stops at the boundary and beside a parallel street', () => {
  const f = createTensorField([{ kind: 'grid', theta: 0, weight: 1 }]);
  const samples = new SampleIndex(20);
  const opts = {
    step: 5,
    maxLength: 2000,
    dtest: 20,
    cosParallel: Math.cos(Math.PI / 6),
    maxTurn: Math.PI / 6,
    allowed: (p: { x: number; y: number }) => p.x >= 0 && p.x <= 300 && p.y >= 0 && p.y <= 300,
    samples,
  };
  const tr = traceStreamline(f, v(150, 100), 'major', opts)!;
  assert.deepEqual(tr.ends, ['boundary', 'boundary']);
  near(tr.points[0]!.x, 0, 0.3);
  near(tr.points[tr.points.length - 1]!.x, 300, 0.3);
  assert.ok(tr.points.every((p) => p.y === 100));
  // A parallel street 10 m away from x=200 on stops the trace; a crossing one does not.
  samples.addPolyline([v(200, 110), v(300, 110)], 5);
  samples.addPolyline([v(100, 0), v(100, 300)], 5);
  const tr2 = traceStreamline(f, v(150, 100), 'major', opts)!;
  assert.equal(tr2.ends[1], 'separation');
  assert.ok(tr2.points[tr2.points.length - 1]!.x < 200);
  assert.equal(tr2.ends[0], 'boundary', 'the crossing street at x=100 does not stop it');
});

test('simplify + enforceVertexGap keep ends and drop near vertices', () => {
  const pts = [v(0, 0), v(3, 0.01), v(6, 0), v(9, 0.02), v(30, 0), v(33, 0)];
  const s = enforceVertexGap(simplify(pts, 0.5), 10);
  assert.deepEqual(s[0], v(0, 0));
  assert.deepEqual(s[s.length - 1], v(33, 0));
  for (let i = 1; i < s.length; i++) assert.ok(Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y) >= 10);
});
