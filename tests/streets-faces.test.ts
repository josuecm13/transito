import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EdgeProps } from '../src/world/streets/planar-graph.ts';
import { PlanarGraph } from '../src/world/streets/planar-graph.ts';
import { buildBlocks, extractFaces, minObbWidth } from '../src/world/streets/faces.ts';

const local: EdgeProps = { cls: 'local', width: 7, sidewalk: 2, fixed: false };
const frame: EdgeProps = { cls: 'frame', width: 0, sidewalk: 0, fixed: false, frame: 'area' };
const v = (x: number, y: number) => ({ x, y });
const opts = { isInside: () => true, districtOf: () => 'd' };

function grid(n: number, step: number): PlanarGraph {
  const g = new PlanarGraph();
  for (let i = 0; i <= n; i++) {
    g.addSegment(v(0, i * step), v(n * step, i * step), local);
    g.addSegment(v(i * step, 0), v(i * step, n * step), local);
  }
  return g;
}

const signedArea = (r: { x: number; y: number }[]) => r.reduce((s, p, i) => {
  const q = r[(i + 1) % r.length]!;
  return s + (p.x * q.y - q.x * p.y) / 2;
}, 0);

test('3x3 street grid: faces are exactly the 9 expected blocks (CCW, 100x100 each)', () => {
  const g = grid(3, 100);
  const blocks = buildBlocks(g.snapshot(), opts);
  assert.equal(blocks.length, 9);
  const got = blocks.map((b) => {
    const xs = b.ring.map((p) => p.x);
    const ys = b.ring.map((p) => p.y);
    return `${Math.min(...xs)},${Math.min(...ys)}`;
  }).sort();
  const want: string[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) want.push(`${i * 100},${j * 100}`);
  assert.deepEqual(got, want.sort());
  for (const b of blocks) {
    assert.equal(b.ring.length, 4);
    assert.ok(Math.abs(b.area - 10000) < 1e-6);
    assert.ok(signedArea(b.ring) > 0, 'counter-clockwise');
    assert.equal(b.isMedian, false);
    assert.deepEqual(b.frameKinds, []);
    assert.equal(b.district, 'd');
  }
  const { outer } = extractFaces(g.snapshot());
  assert.equal(outer.length, 1, 'one outer face');
  assert.ok(Math.abs(outer[0]!.area + 90000) < 1e-6);
});

test('dead-end street inside a block: same block, antenna in boundary but not in ring', () => {
  const g = grid(1, 100);
  g.addSegment(v(0, 50), v(40, 50), local);
  const blocks = buildBlocks(g.snapshot(), opts);
  assert.equal(blocks.length, 1);
  const b = blocks[0]!;
  assert.ok(Math.abs(b.area - 10000) < 1e-6);
  assert.equal(b.ring.length, 5, 'square ring (with the T node on its side), no spike');
  assert.equal(b.boundary.length, 7, '5 ring half-edges + 2 antenna half-edges');
});

test('loop hanging from a bridge becomes a hole; a separate component inside becomes a hole too', () => {
  for (const bridged of [true, false]) {
    const g = grid(1, 100);
    g.addPolyline([v(40, 40), v(60, 40), v(60, 60), v(40, 60), v(40, 40)], local);
    if (bridged) g.addSegment(v(0, 50), v(40, 50), local);
    const blocks = buildBlocks(g.snapshot(), opts);
    assert.equal(blocks.length, 2, `bridged=${bridged}`);
    const big = blocks.find((b) => b.area > 1000)!;
    const small = blocks.find((b) => b.area < 1000)!;
    assert.ok(Math.abs(small.area - 400) < 1e-6);
    assert.ok(Math.abs(big.area - 9600) < 1e-6, `outer block area ${big.area}`);
    assert.equal(big.holes.length, 1);
    assert.ok(Math.abs(Math.abs(signedArea(big.holes[0]!)) - 400) < 1e-6);
    assert.ok(Math.abs(signedArea(big.ring) - 10000) < 1e-6);
    // The interior point is in the ring and outside the hole.
    const p = big.interior;
    assert.ok(!(p.x > 40 && p.x < 60 && p.y > 40 && p.y < 60));
  }
});

test('median: a 6 m strip between two locals is a median, a 60 m block is not; frame kinds and clipping', () => {
  const g = new PlanarGraph();
  g.addSegment(v(0, 0), v(200, 0), local);
  g.addSegment(v(0, 6), v(200, 6), local);
  g.addSegment(v(0, 66), v(200, 66), local);
  g.addSegment(v(0, 0), v(0, 66), frame);
  g.addSegment(v(200, 0), v(200, 66), local);
  const blocks = buildBlocks(g.snapshot(), opts);
  assert.equal(blocks.length, 2);
  const strip = blocks.find((b) => b.area < 2000)!;
  const block = blocks.find((b) => b.area > 2000)!;
  assert.equal(strip.isMedian, true);
  assert.equal(block.isMedian, false);
  assert.ok(block.buildableWidth > 40 && block.buildableWidth < 60, `buildable ${block.buildableWidth}`);
  assert.deepEqual(block.frameKinds, ['area']);
  assert.equal(block.isClipped, true);
  assert.ok(Math.abs(minObbWidth(block.ring) - 60) < 1e-9);
});

test('faces outside the playable test are dropped', () => {
  const g = grid(2, 100);
  const blocks = buildBlocks(g.snapshot(), { isInside: (p) => p.x < 100, districtOf: () => undefined });
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((b) => b.interior.x < 100 && b.district === undefined));
});
