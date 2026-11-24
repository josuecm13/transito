// Act 1 placement on the generated map (#12 2.2; procedural.act1, src/world/proc/act1.ts).
// The director placed Act 1 by structure: Tito's barrio at the midpoint of Línea 2's branch to the
// airport, the act's strip along that track to the airport. Nothing here may be a hard-coded point.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { parseWorldSpec, WorldSpecError } from '../src/world/spec.ts';
import { distanceToPolyline, pointInPolygon } from '../src/world/geometry.ts';
import { cellAt, makeShape, mask } from '../src/world/proc/grid.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { placeAct1, splitAt, trackLength } from '../src/world/proc/act1.ts';
import { snapToTown } from '../src/world/proc/landmarks.ts';
import { field } from '../src/world/proc/grid.ts';

const yaml = readFileSync(new URL('../specs/map/world.yaml', import.meta.url), 'utf8');
const spec = parseWorldSpec(yaml);
const A = spec.procedural.act1;
let iso: Isthmus;
before(() => {
  iso = generateIsthmus(spec);
});
const followed = (g: Isthmus): readonly { x: number; y: number }[] => g.transit.lines.find((l) => l.id === A.line)!.tracks[A.branch]!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

test('spec: act1 names a line, the branch ending at the airport and a town, with no coordinates', () => {
  assert.equal(A.line, 'linea-2');
  assert.equal(A.branchTo, 'airport-terminal');
  assert.equal(A.branch, 1); // [north, corridor-east, airport-terminal]
  assert.equal(A.anchorAt, 0.5);
  assert.equal(A.town, 'el-corredor');
  assert.equal(spec.procedural.towns.items[A.townIndex]!.id, 'el-corredor');
  assert.doesNotMatch(yaml.slice(yaml.indexOf('\n  act1:'), yaml.indexOf('strip_half_width')), /\[\s*\d+\s*,\s*\d+\s*\]/);
});

test('spec: broken act1 blocks are rejected', () => {
  const broken = (from: RegExp, to: string, why: RegExp): void => {
    const text = yaml.replace(from, to);
    assert.notEqual(text, yaml, `mutation ${from} must change the yaml`);
    assert.throws(() => parseWorldSpec(text), (e: unknown) => e instanceof WorldSpecError && why.test(e.message), String(from));
  };
  broken(/line: linea-2\n/, 'line: linea-9\n', /act1\.line: unknown transit line "linea-9"/);
  broken(/branch_to: airport-terminal /, 'branch_to: north ', /act1\.branch_to: 0 branches of linea-2 end at "north"/);
  broken(/anchor_at: 0\.5 /, 'anchor_at: 0 ', /anchor_at: must be strictly between 0 and 1/);
  broken(/anchor_at: 0\.5 /, 'anchor_at: 1.2 ', /anchor_at: expected a fraction/);
  broken(/town: el-corredor /, 'town: el-barrio ', /act1\.town: unknown town "el-barrio"/);
  broken(/ {4}strip_half_width: 400 .*\n/, '', /act1\.strip_half_width: missing/);
});

test('the anchor is the point at anchor_at of the routed branch to the airport, on dry land', () => {
  const t = followed(iso);
  assert.ok(dist(t[t.length - 1]!, iso.airport.terminal) < 250, `branch ends ${dist(t[t.length - 1]!, iso.airport.terminal).toFixed(0)} m from the terminal`);
  const { point } = splitAt(t, A.anchorAt);
  assert.ok(dist(iso.act1.anchor, point) < 1e-9);
  assert.ok(iso.act1.anchorDry, 'anchor on land, not lake');
  assert.ok(iso.height.data[cellAt(iso.height, point.x, point.y)]! > 0, 'anchor above sea level');
  // The strip runs from the anchor to the branch end.
  const s = iso.act1.strip;
  assert.ok(dist(s.centreline[0]!, point) < 1e-9 && dist(s.centreline[s.centreline.length - 1]!, t[t.length - 1]!) < 1e-9);
  assert.ok(Math.abs(s.lengthM - (1 - A.anchorAt) * trackLength(t)) < 1, `strip ${s.lengthM} m`);
  assert.equal(s.halfWidth, A.stripHalfWidth);
  assert.ok(iso.report.some((l) => l.startsWith('act1: linea-2 → airport-terminal')));
});

test("Tito's barrio is El Corredor's", () => {
  assert.ok(iso.act1.townShare >= 0.6, `${(iso.act1.townShare * 100).toFixed(0)}% of the barrio's built cells are El Corredor`);
  // Counter-check: measured as la-ciudad's, the same barrio is not.
  const other = placeAct1(followed(iso), iso.towns.owner, iso.towns.density, iso.relief.land, iso.lake.lake, { ...A, town: 0 });
  assert.ok(other.townShare <= 0.2, `la-ciudad share ${other.townShare}`);
});

test('derived, not hard-coded: another anchor_at moves the barrio along the same track', () => {
  const moved = generateIsthmus(parseWorldSpec(yaml.replace(/anchor_at: 0\.5 /, 'anchor_at: 0.25 ')));
  const t = followed(moved);
  assert.ok(dist(moved.act1.anchor, splitAt(t, 0.25).point) < 1e-9);
  assert.ok(dist(moved.act1.anchor, iso.act1.anchor) > 300, `moved ${dist(moved.act1.anchor, iso.act1.anchor).toFixed(0)} m`);
  // The landmarks hang off the placement, so they move with it.
  const home = (g: Isthmus) => g.landmarks.find((l) => l.id === 'tito-home')!.at;
  assert.ok(dist(home(moved), moved.act1.anchor) < 100 && dist(home(moved), home(iso)) > 300);
});

// ------------------------------------------------------------------ landmarks (#12 2.3)

const L = spec.procedural.landmarks;
const at = (id: string) => iso.landmarks.find((l) => l.id === id)!.at;
const ownerAt = (q: { x: number; y: number }) => iso.towns.owner[cellAt(iso.towns.density, q.x, q.y)]!;
const dry = (q: { x: number; y: number }) => iso.relief.land.data[cellAt(iso.relief.land, q.x, q.y)] === 1 && iso.lake.lake.data[cellAt(iso.lake.lake, q.x, q.y)] !== 1;

test('spec: landmark rules name existing landmarks; broken rules are rejected', () => {
  assert.deepEqual(L.map((l) => l.id), ['tito-home', 'corridor-market', 'miguelito-hills', 'passenger-terminal', 'cargo-terminal']);
  assert.ok(L.every((l) => spec.landmarks.some((m) => m.id === l.id)));
  const broken = (from: RegExp, to: string, why: RegExp): void => {
    const text = yaml.replace(from, to);
    assert.notEqual(text, yaml, `mutation ${from} must change the yaml`);
    assert.throws(() => parseWorldSpec(text), (e: unknown) => e instanceof WorldSpecError && why.test(e.message), String(from));
  };
  broken(/ {4}tito-home: anchor/, '    tito-house: anchor', /landmarks\.tito-house: unknown landmark/);
  broken(/{ airport: apron }/, '{ airport: hangar }', /cargo-terminal\.airport: expected terminal \| apron/);
  broken(/{ along: 170 }/, '{ along: 170, airport: apron }', /corridor-market: expected anchor/);
  broken(/{ steepest_within: 600 }/, '{ steepest_within: -5 }', /steepest_within: must be > 0/);
});

test("Act 1 landmarks sit on El Corredor's dry ground, inside the barrio and the strip", () => {
  const town = spec.procedural.act1.townIndex + 1;
  for (const id of ['tito-home', 'corridor-market', 'miguelito-hills']) {
    assert.ok(dry(at(id)), `${id} on dry land`);
    assert.equal(ownerAt(at(id)), town, `${id} on an El Corredor cell`);
  }
  assert.ok(dist(at('tito-home'), iso.act1.anchor) <= iso.height.cell, 'the house is the barrio centre');
  const s = iso.act1.strip;
  const toStrip = distanceToPolyline(at('corridor-market'), s.centreline as never);
  assert.ok(toStrip <= s.halfWidth, `shop ${toStrip.toFixed(0)} m off the strip`);
  const shop = dist(at('corridor-market'), at('tito-home'));
  assert.ok(shop >= 100 && shop <= 300, `shop ${shop.toFixed(0)} m from the house`);
  assert.ok(dist(at('miguelito-hills'), iso.act1.anchor) <= 600 + iso.height.cell);
});

test('miguelito-hills is the steepest El Corredor ground near the barrio', () => {
  const h = iso.height;
  const slope = (q: { x: number; y: number }) => {
    const c = cellAt(h, q.x, q.y);
    const x = c % h.w;
    const y = Math.floor(c / h.w);
    const v = (i: number, j: number) => h.data[j * h.w + i]!;
    return Math.hypot(v(x + 1, y) - v(x - 1, y), v(x, y + 1) - v(x, y - 1)) / (2 * h.cell);
  };
  const hills = slope(at('miguelito-hills'));
  const home = slope(at('tito-home'));
  assert.ok(hills > home, `hills ${hills.toFixed(3)} vs home ${home.toFixed(3)} m/m`);
  // No El Corredor cell within the radius is steeper.
  const town = spec.procedural.act1.townIndex + 1;
  for (let c = 0; c < iso.towns.owner.length; c++) {
    if (iso.towns.owner[c] !== town) continue;
    const q = { x: ((c % h.w) + 0.5) * h.cell, y: (Math.floor(c / h.w) + 0.5) * h.cell };
    if (dist(q, iso.act1.anchor) > 600 || q.x < h.cell || q.y < h.cell) continue;
    assert.ok(slope(q) <= hills + 1e-9, `(${q.x}, ${q.y}) is steeper`);
  }
});

test('airport landmarks sit on the generated airport', () => {
  assert.ok(dist(at('passenger-terminal'), iso.airport.terminal) < 1e-9);
  assert.ok(pointInPolygon(at('cargo-terminal'), iso.airport.field as never), 'cargo terminal inside the airfield');
  assert.ok(pointInPolygon(at('cargo-terminal'), iso.airport.apronRing as never), 'on the apron');
});

test('pure: splitAt and the dry-anchor check on a synthetic lake', () => {
  const track = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.deepEqual(splitAt(track, 0.25).point, { x: 50, y: 0 });
  assert.deepEqual(splitAt(track, 0.75).rest, [{ x: 100, y: 50 }, { x: 100, y: 100 }]);
  const shape = makeShape(200, 200, 10);
  const land = mask(shape);
  land.data.fill(1);
  const lake = mask(shape);
  lake.data[cellAt(lake, 100, 0)] = 1;
  const owner = new Uint8Array(400);
  const p = { line: 'x', branch: 0, anchorAt: 1 / 3, town: 0, barrioRadius: 30, stripHalfWidth: 10 };
  assert.equal(placeAct1(track, owner, shape, land, lake, p).anchorDry, true);
  assert.equal(placeAct1(track, owner, shape, land, lake, { ...p, anchorAt: 0.5 }).anchorDry, false);
});

test('pure: snapToTown moves a point to the nearest cell of the town, and leaves it when none is near', () => {
  const g = field(makeShape(200, 200, 10));
  const owner = new Uint8Array(g.w * g.h);
  owner[cellAt(g, 155, 55)] = 3; // town index 2
  owner[cellAt(g, 15, 15)] = 1; // another town, nearer
  assert.deepEqual(snapToTown({ x: 52, y: 52 }, owner, g, 2), { x: 155, y: 55 });
  assert.deepEqual(snapToTown({ x: 52, y: 52 }, owner, g, 2, 50), { x: 52, y: 52 });
});
