import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorldData } from '../src/world/world-data.ts';
import { DEFAULT_PARKING, carFootprint, findParkingSpot, polygonsOverlap } from '../src/world/parking.ts';
import { buildingCorners } from '../src/world/blockout.ts';
import { distanceToSegment, pointInPolygon } from '../src/world/geometry.ts';
import type { GraphSnapshot } from '../src/world/streets/planar-graph.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const data = buildWorldData(yaml);
const spawn = data.slice.spawn.position;
const spot = findParkingSpot(data.streets.graph, data.buildings, spawn);

test('real world: a parking spot exists within 40 m of the spawn', () => {
  assert.ok(spot, 'no spot found');
  const d = Math.hypot(spot.position.x - spawn.x, spot.position.y - spawn.y);
  assert.ok(d <= 40 && d >= DEFAULT_PARKING.minDistance, `distance ${d}`);
});

test('real world: deterministic', () => {
  assert.deepEqual(findParkingSpot(data.streets.graph, data.buildings, spawn), spot);
});

test('real world: on a drivable edge, heading along it, inside its carriageway', () => {
  assert.ok(spot);
  const e = data.streets.graph.edges[spot.edge];
  assert.ok(e && e.cls !== 'frame' && e.cls !== 'alley', `edge class ${e?.cls}`);
  const a = data.streets.graph.nodes[e.a]!;
  const b = data.streets.graph.nodes[e.b]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const cross = ((b.x - a.x) * spot.heading.y - (b.y - a.y) * spot.heading.x) / len;
  const dot = ((b.x - a.x) * spot.heading.x + (b.y - a.y) * spot.heading.y) / len;
  assert.ok(Math.abs(cross) < 1e-9 && Math.abs(Math.abs(dot) - 1) < 1e-9, `cross ${cross} dot ${dot}`);
  assert.ok(Math.abs(Math.hypot(spot.heading.x, spot.heading.y) - 1) < 1e-9);
  for (const c of carFootprint(spot.position, spot.heading, DEFAULT_PARKING)) {
    assert.ok(distanceToSegment(c, a, b) <= e.width / 2 + 1e-9, 'corner outside the carriageway');
  }
});

test('real world: the footprint does not touch any building (corner and containment checks)', () => {
  assert.ok(spot);
  const car = carFootprint(spot.position, spot.heading, DEFAULT_PARKING);
  for (const bd of data.buildings) {
    const poly = buildingCorners(bd);
    assert.ok(!polygonsOverlap(car, poly), `overlaps building at ${bd.center.x},${bd.center.y}`);
    assert.ok(!car.some((c) => pointInPolygon(c, poly)));
    assert.ok(!poly.some((c) => pointInPolygon(c, car)));
  }
});

// ---- synthetic street: a 100 m local street along +x ----
const street: GraphSnapshot = {
  nodes: [
    { id: 0, x: 0, y: 0, pinned: false },
    { id: 1, x: 100, y: 0, pinned: false },
  ],
  edges: [{ id: 0, a: 0, b: 1, cls: 'local', width: 7, sidewalk: 2, fixed: false, length: 100 }],
};

test('synthetic: parks on the right-hand kerb, nose along the travel direction', () => {
  const s = findParkingSpot(street, [], { x: 50, y: 0 }, { minDistance: 0 });
  assert.ok(s);
  // Nearest candidate to the origin: a point 3.5 - 0.9 - 0.3 = 2.3 m off the axis, on the right.
  assert.ok(Math.abs(Math.abs(s.position.y) - 2.3) < 1e-9, `offset ${s.position.y}`);
  const rightOfHeading = s.heading.x > 0 ? s.position.y < 0 : s.position.y > 0;
  assert.ok(rightOfHeading, 'not on the right-hand side of its heading');
  assert.equal(s.heading.y, 0);
});

test('synthetic: a building on the kerb pushes the spot elsewhere, but not into the building', () => {
  const free = findParkingSpot(street, [], { x: 50, y: 0 }, { minDistance: 0 })!;
  const block = { center: { ...free.position }, width: 10, depth: 3, angle: 0, height: 5, district: 'x' };
  const s = findParkingSpot(street, [block], { x: 50, y: 0 }, { minDistance: 0 });
  assert.ok(s, 'other spot (other side of the street) expected');
  assert.notDeepEqual(s.position, free.position);
  assert.ok(!polygonsOverlap(carFootprint(s.position, s.heading, DEFAULT_PARKING), buildingCorners(block)));
});

test('synthetic: never parks on a crossing carriageway', () => {
  const cross: GraphSnapshot = {
    nodes: [...street.nodes, { id: 2, x: 50, y: -40, pinned: false }, { id: 3, x: 50, y: 40, pinned: false }],
    edges: [...street.edges, { id: 1, a: 2, b: 3, cls: 'local', width: 7, sidewalk: 2, fixed: false, length: 80 }],
  };
  const s = findParkingSpot(cross, [], { x: 50, y: 0 }, { minDistance: 0 });
  assert.ok(s);
  // Whichever street it chose, no corner may lie on the other one's carriageway (half width 3.5).
  const other = s.edge === 0 ? [{ x: 50, y: -40 }, { x: 50, y: 40 }] : [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  for (const c of carFootprint(s.position, s.heading, DEFAULT_PARKING)) {
    assert.ok(distanceToSegment(c, other[0]!, other[1]!) >= 3.5, `corner ${c.x},${c.y} on the other street`);
  }
});

test('synthetic: nothing within range gives undefined; alleys and frame edges are not parkable', () => {
  assert.equal(findParkingSpot(street, [], { x: 50, y: 500 }), undefined);
  const alley: GraphSnapshot = { ...street, edges: [{ ...street.edges[0]!, cls: 'alley' }] };
  assert.equal(findParkingSpot(alley, [], { x: 50, y: 0 }, { minDistance: 0 }), undefined);
});

test('polygonsOverlap: overlapping, disjoint, touching', () => {
  const sq = (x: number, y: number) => [{ x, y }, { x: x + 2, y }, { x: x + 2, y: y + 2 }, { x, y: y + 2 }];
  assert.ok(polygonsOverlap(sq(0, 0), sq(1, 1)));
  assert.ok(!polygonsOverlap(sq(0, 0), sq(3, 0)));
  assert.ok(!polygonsOverlap(sq(0, 0), sq(2, 0)));
});
