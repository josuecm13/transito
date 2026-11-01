import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStreetSurfaces, ringOutline, STREET_LAYERS } from '../src/world/street-surface.ts';
import type { TriSoup } from '../src/world/street-surface.ts';
import type { EdgeProps, GraphSnapshot } from '../src/world/streets/planar-graph.ts';
import type { Vec2 } from '../src/world/vec.ts';

const AVENUE: EdgeProps = { cls: 'avenue', width: 14, sidewalk: 3, fixed: true };
const COLLECTOR: EdgeProps = { cls: 'collector', width: 10, sidewalk: 2.5, fixed: false };
const LOCAL: EdgeProps = { cls: 'local', width: 7, sidewalk: 2, fixed: false };
const FRAME: EdgeProps = { cls: 'frame', width: 0, sidewalk: 0, fixed: false, frame: 'coast' };

function graph(nodes: [number, number][], edges: [number, number, EdgeProps][]): GraphSnapshot {
  const ns = nodes.map(([x, y], id) => ({ id, x, y, pinned: false }));
  return {
    nodes: ns,
    edges: edges.map(([a, b, p], id) => {
      const na = ns[a] as Vec2;
      const nb = ns[b] as Vec2;
      return { id, a, b, length: Math.hypot(nb.x - na.x, nb.y - na.y), ...p };
    }),
  };
}

/**
 * Avenue along y = 0 through a centre node 0, collector north (x = 0, 0..80), local south
 * (x = 0, 0..-60), and a frame edge east of the avenue end.
 */
const CROSS = graph(
  [[0, 0], [100, 0], [-100, 0], [0, 80], [0, -60], [200, 0]],
  [[0, 1, AVENUE], [2, 0, AVENUE], [0, 3, COLLECTOR], [4, 0, LOCAL], [1, 5, FRAME]],
);

function triangles(s: TriSoup): [Vec2, Vec2, Vec2][] {
  const p = (i: number): Vec2 => ({ x: s.positions[2 * i] as number, y: s.positions[2 * i + 1] as number });
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < s.indices.length; i += 3) out.push([p(s.indices[i] as number), p(s.indices[i + 1] as number), p(s.indices[i + 2] as number)]);
  return out;
}
const cross2 = (a: Vec2, b: Vec2, c: Vec2): number => (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
const area = (s: TriSoup): number => triangles(s).reduce((sum, [a, b, c]) => sum + cross2(a, b, c) / 2, 0);
const covers = (s: TriSoup, q: Vec2): boolean =>
  triangles(s).some(([a, b, c]) => cross2(a, b, q) >= -1e-9 && cross2(b, c, q) >= -1e-9 && cross2(c, a, q) >= -1e-9);
const all = (r: ReturnType<typeof buildStreetSurfaces>): TriSoup[] => [
  r.sidewalk,
  ...STREET_LAYERS.map((c) => r.carriageway[c]),
  r.centerSolid,
  r.centerDashed,
];

test('every triangle is counter-clockwise (faces up) and non-degenerate', () => {
  const r = buildStreetSurfaces(CROSS);
  for (const s of all(r)) for (const [a, b, c] of triangles(s)) assert.ok(cross2(a, b, c) > 1e-9);
});

test('frame edges draw nothing; each street fills its own class layer', () => {
  const r = buildStreetSurfaces(CROSS);
  for (const s of all(r)) for (const [a, b, c] of triangles(s)) for (const p of [a, b, c]) assert.ok(p.x <= 110 + 1e-9, `vertex at x=${p.x}`); // node 1 joint radius 10
  assert.ok(!covers(r.sidewalk, { x: 150, y: 0 }) && !covers(r.carriageway.avenue, { x: 150, y: 0 }));
  assert.ok(covers(r.carriageway.avenue, { x: 50, y: 6.9 }));
  assert.ok(!covers(r.carriageway.avenue, { x: 50, y: 7.1 }));
  assert.ok(covers(r.carriageway.collector, { x: 4.9, y: 40 }));
  assert.ok(covers(r.carriageway.local, { x: -3.4, y: -30 }));
  assert.equal(r.carriageway.alley.indices.length, 0);
  // Sidewalks on both sides, at the right offsets.
  assert.ok(covers(r.sidewalk, { x: 50, y: 8.5 }) && covers(r.sidewalk, { x: 50, y: -8.5 }));
  assert.ok(covers(r.sidewalk, { x: 6, y: 40 }) && covers(r.sidewalk, { x: -6, y: 40 }));
  assert.ok(!covers(r.sidewalk, { x: 50, y: 10.5 }));
  assert.ok(!covers(r.sidewalk, { x: 50, y: 0 }));
});

test('band areas: carriageway = width x length + joints, sidewalks = 2 x sidewalk x length + joints', () => {
  const step = (10 * Math.PI) / 180;
  const r = buildStreetSurfaces(CROSS, { discSegments: 64, arcStep: step });
  const disc = (rad: number): number => 0.5 * 64 * rad * rad * Math.sin((2 * Math.PI) / 64);
  const half = (rad: number): number => 0.5 * 18 * rad * rad * Math.sin(step); // 180° sector, 18 chords
  // Avenue: 200 m long, 14 wide; full disc at the degree-4 node 0, rounded caps at dead ends 1 and 2.
  assert.ok(Math.abs(area(r.carriageway.avenue) - (200 * 14 + disc(7) + 2 * half(7))) < 1e-6);
  assert.ok(Math.abs(area(r.carriageway.collector) - (80 * 10 + half(5))) < 1e-6); // cap at node 3
  assert.ok(Math.abs(area(r.carriageway.local) - (60 * 7 + half(3.5))) < 1e-6); // cap at node 4
  const sidewalk = 2 * (200 * 3 + 80 * 2.5 + 60 * 2) + disc(10) + 2 * half(10) + half(7.5) + half(5.5);
  assert.ok(Math.abs(area(r.sidewalk) - sidewalk) < 1e-6);
});

test('the junction is paved by the widest street; dead ends are rounded', () => {
  const r = buildStreetSurfaces(CROSS);
  assert.ok(covers(r.carriageway.avenue, { x: 0, y: 0 }));
  assert.ok(covers(r.carriageway.avenue, { x: 100 + 5, y: 0 })); // rounded cap past the end node
  assert.ok(covers(r.carriageway.collector, { x: 0, y: 84 }));
});

test('centre lines: solid on avenues, dashed on collectors, never onto a wider street', () => {
  const r = buildStreetSurfaces(CROSS, { dash: 3, gap: 3 });
  assert.ok(covers(r.centerSolid, { x: 50, y: 0 }) && covers(r.centerSolid, { x: 0, y: 0 }));
  assert.ok(!covers(r.centerSolid, { x: 50, y: 0.2 }));
  const dashed = triangles(r.centerDashed).flat();
  assert.ok(dashed.length > 0);
  for (const p of dashed) assert.ok(p.y >= 7 - 1e-9, `collector line enters the avenue at y=${p.y}`);
  // 73 m of line (80 - avenue half width 7), period 6 m -> 13 dashes, 2 triangles each.
  assert.equal(r.centerDashed.indices.length / 6, 13);
  assert.ok(covers(r.centerDashed, { x: 0, y: 8 }) && !covers(r.centerDashed, { x: 0, y: 11 }));
  // No markings on locals.
  assert.ok(!covers(r.centerDashed, { x: 0, y: -30 }) && !covers(r.centerSolid, { x: 0, y: -30 }));
});

test('straight degree-2 nodes get no joint; a bend gets an exact sector on its outer side', () => {
  const straight = graph([[0, 0], [50, 0], [100, 0]], [[0, 1, LOCAL], [1, 2, LOCAL]]);
  const bent = graph([[0, 0], [50, 0], [50, 50]], [[0, 1, LOCAL], [1, 2, LOCAL]]);
  const step = (10 * Math.PI) / 180;
  const s = buildStreetSurfaces(straight, { arcStep: step });
  const b = buildStreetSurfaces(bent, { arcStep: step });
  // 2 bands x 2 triangles + 2 rounded dead ends x 18 chords.
  assert.equal(s.carriageway.local.indices.length / 3, 4 + 36);
  // + the 90° outer-corner sector (9 chords); nothing on the inner side.
  assert.equal(b.carriageway.local.indices.length / 3, 4 + 36 + 9);
  // The outer corner is paved, right up to the band edges (no sliver where joint meets band).
  assert.ok(covers(b.carriageway.local, { x: 52, y: -2 }));
  assert.ok(covers(b.carriageway.local, { x: 50.05, y: -3.49 }) && covers(b.carriageway.local, { x: 53.49, y: 0.05 }));
  assert.ok(!covers(b.carriageway.local, { x: 53, y: -3 })); // beyond the 3.5 m radius
  // Same for the sidewalk ring around the outer corner (radius 3.5 + 2).
  assert.ok(covers(b.sidewalk, { x: 50.05, y: -5.49 }) && covers(b.sidewalk, { x: 54, y: -3 }));
});

test('ringOutline: inner strip of the given width, either ring orientation', () => {
  const sq: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  for (const ring of [sq, [...sq].reverse()]) {
    const o = ringOutline(ring, 1);
    assert.ok(Math.abs(area(o) - (100 - 64)) < 1e-9);
    for (const [a, b, c] of triangles(o)) assert.ok(cross2(a, b, c) > 0);
    assert.ok(covers(o, { x: 0.5, y: 5 }) && !covers(o, { x: 5, y: 5 }) && !covers(o, { x: -0.5, y: 5 }));
  }
});
