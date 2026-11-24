import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { districtAt, districtLabelPoint, parseWorldSpec, WorldSpecError } from '../src/world/spec.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');

test('real world.yaml parses', () => {
  const spec = parseWorldSpec(yaml);
  assert.ok(spec.land.length > 10);
  assert.ok(spec.routes.some((r) => r.id === 'corridor-avenue'));
  assert.equal(spec.grid.length, spec.bounds.height / spec.bounds.cellSize);
});

test('corridor-market display name and trigger radius come from data', () => {
  const m = parseWorldSpec(yaml).landmarks.find((l) => l.id === 'corridor-market');
  assert.equal(m?.displayName, 'Tienda de Doña Mireya');
  assert.equal(typeof m?.triggerRadius, 'number');
});

test('districtAt follows the grid, north row first', () => {
  const spec = parseWorldSpec(yaml);
  const home = spec.landmarks.find((l) => l.id === 'tito-home')!;
  assert.equal(districtAt(spec, home.position)?.id, home.district);
  const cm = spec.landmarks.find((l) => l.id === 'corridor-market')!;
  assert.equal(districtAt(spec, cm.position)?.id, cm.district);
  assert.equal(districtAt(spec, { x: -1, y: 0 }), undefined);
});

test('broken yaml reports every problem at once', () => {
  const broken = yaml
    .replace(/^active_area:/m, 'removed_area:')
    .replace(/^ {4}airport: /m, '    not-a-district: ');
  assert.notEqual(broken, yaml);
  assert.throws(
    () => parseWorldSpec(broken),
    (e: unknown) => {
      assert.ok(e instanceof WorldSpecError);
      assert.ok(e.problems.some((p) => p.startsWith('active_area')), e.problems.join('|'));
      assert.ok(e.problems.some((p) => p.includes('not-a-district')), e.problems.join('|'));
      return true;
    },
  );
});

test('population.pedestrians.walk_on lists street classes: all of them in world.yaml', () => {
  assert.deepEqual(parseWorldSpec(yaml).population.pedestrians.walkOn, ['avenue', 'collector', 'local', 'alley']);
});

test('population.pedestrians.walk_on rejects a route kind / unknown class', () => {
  const broken = yaml.replace(/^( {4}walk_on:) \[.*\]$/m, '$1 [arterial, local]');
  assert.notEqual(broken, yaml);
  assert.throws(
    () => parseWorldSpec(broken),
    (e: unknown) => {
      assert.ok(e instanceof WorldSpecError);
      assert.ok(e.problems.some((p) => p.startsWith('population.pedestrians.walk_on') && p.includes('arterial')), e.problems.join('|'));
      return true;
    },
  );
});

test('raw world.yaml loads with js-yaml load, no preprocessing', () => {
  const doc = load(yaml) as { geometry: { land: unknown[] } };
  assert.ok(doc.geometry.land.length > 10);
});

test('district labels and water labels are exposed', () => {
  const spec = parseWorldSpec(yaml);
  const c = spec.districts.find((d) => d.id === 'colon')!;
  assert.ok(c.labelAt && c.sub);
  assert.ok(spec.waterLabels.some((w) => w.name === 'Mar Caribe'));
  assert.ok(spec.islands.length > 0 && spec.islands.every((i) => i.points.length >= 3));
});

test('districtLabelPoint: label_at wins, else a land cell of the district, open sea gets none', () => {
  const spec = parseWorldSpec(yaml);
  const byId = (id: string) => spec.districts.find((d) => d.id === id)!;
  assert.deepEqual(districtLabelPoint(spec, byId('colon')), byId('colon').labelAt);
  for (const id of ['gatun-lake', 'jungle-ridge']) {
    const p = districtLabelPoint(spec, byId(id));
    assert.ok(p, id);
    assert.equal(districtAt(spec, p)?.id, id);
  }
  assert.equal(districtLabelPoint(spec, byId('sea')), undefined);
});

test('street_styles: the three active-area districts parse with their style and references', () => {
  const ss = parseWorldSpec(yaml).streetStyles;
  assert.ok(Number.isInteger(ss.seed));
  assert.equal(ss.hierarchy.alley.sidewalk, 0);
  assert.ok(ss.hierarchy.collector.width > ss.hierarchy.local.width);
  assert.deepEqual(Object.keys(ss.districts).sort(), ['airport', 'costa-del-este', 'tito-corridor']);

  const corridor = ss.districts['tito-corridor']!;
  assert.equal(corridor.style, 'informal');
  assert.equal(corridor.reference[0]?.name, 'La Carpio');
  assert.equal(corridor.reference[0]?.importAreaId, '6320bab5-c7e1-436d-a7bd-c542ee355cb7');
  assert.equal(corridor.realismExemptReason, undefined);

  const cde = ss.districts['costa-del-este']!;
  assert.equal(cde.style, 'formal');
  assert.ok(cde.style === 'formal' && cde.field.some((f) => f.kind === 'grid' && f.angle === -8));
  assert.ok(cde.style === 'formal' && cde.field.some((f) => f.kind === 'coastline'));
  assert.equal(cde.reference[0]?.name, 'Santa Ana');

  const airport = ss.districts.airport!;
  assert.equal(airport.style, 'formal');
  assert.ok(airport.realismExemptReason && airport.realismExemptReason.length > 0);

  for (const d of Object.values(ss.districts)) {
    assert.ok(d.landUse.park >= 0 && d.landUse.court >= 0 && d.landUse.park + d.landUse.court < 1);
  }
});

const expectProblem = (broken: string, match: (p: string) => boolean) => {
  assert.notEqual(broken, yaml, 'mutation did not apply');
  assert.throws(
    () => parseWorldSpec(broken),
    (e: unknown) => {
      assert.ok(e instanceof WorldSpecError);
      assert.ok(e.problems.some(match), e.problems.join('|'));
      return true;
    },
  );
};

test('street_styles rejects an unknown style', () => {
  expectProblem(
    yaml.replace(/^( {6}style:) informal$/m, '$1 grid'),
    (p) => p.startsWith('street_styles.districts.tito-corridor.style'),
  );
});

test('street_styles rejects land_use fractions summing to 1 or more', () => {
  expectProblem(
    yaml.replace(/land_use: \{ park: 0\.06, court: 0\.03 \}/, 'land_use: { park: 0.9, court: 0.3 }'),
    (p) => p.includes('land_use: park + court must be < 1'),
  );
  expectProblem(
    yaml.replace(/land_use: \{ park: 0\.06, court: 0\.03 \}/, 'land_use: { park: 0.5, court: 0.5 }'),
    (p) => p.includes('land_use: park + court must be < 1'),
  );
});

test('street_styles rejects an exemption without reason and an oversized unpinned sector', () => {
  expectProblem(
    yaml.replace(/^( {6})realism_reason: .*$/m, ''),
    (p) => p.includes('airport: realism: exempt requires a non-empty realism_reason'),
  );
  expectProblem(
    yaml.replace(/^ {10}import_area_id: df082f58-1e9c-416b-b110-beac5492e128\n/m, ''),
    (p) => p.includes('(Santa Ana)') && p.includes('exceeds 2 km²'),
  );
});

test('layers 1-5 sections parse from world.yaml', () => {
  const spec = parseWorldSpec(yaml);
  assert.equal(spec.relief.grid.far.cell, 16);
  assert.ok(spec.relief.ridges.length >= 2);
  assert.ok(spec.landCover.settlements.length > 0 && spec.landCover.mangrove.shores.length > 0);
  assert.ok(spec.rivers.items.length > 0 && spec.rivers.items.every((r) => r.mouth.x >= 0));
  assert.equal(spec.canal.route, 'canal');
  assert.deepEqual(spec.canal.locks.map((l) => l.chamber), [[305, 34], [305, 34]]);
  assert.ok(spec.waterBodies.some((b) => b.kind === 'lake'));
  // Lake-fed river: the Chagres feeds Gatún Lake; the others have a coast mouth.
  assert.deepEqual(spec.rivers.items.find((r) => r.id === 'rio-chagres')?.outlet, { waterBody: 'gatun-lake' });
  assert.ok(spec.rivers.items.filter((r) => r.id !== 'rio-chagres').every((r) => r.outlet === undefined));
  assert.equal(spec.airports[0]?.runways.length, 2);
  assert.ok(spec.mainRoads.roads.some((r) => r.id === 'interamericana'));
  assert.ok(spec.mainRoads.roads.some((r) => r.id === 'transistmica'));
  assert.ok(spec.mainRoads.roads.some((r) => r.id === 'corredor-sur'));
  assert.ok(spec.mainRoads.roads.some((r) => r.structure === 'viaduct'));
  assert.ok(!spec.mainRoads.roads.some((r) => /norte/i.test(r.id)), 'Corredor Norte is not built');
});

test('new layer sections are strict: an unknown key is rejected in each one', () => {
  const cases: [string, RegExp, string, string][] = [
    ['land_cover', /^land_cover:\n {2}seed: 21$/m, 'land_cover:\n  bogus: 1\n  seed: 21', 'land_cover.bogus'],
    ['land_cover.forest', /^( {4})clearing_below: 0\.25 /m, '$1clearing_below: 0.25\n$1bogus: 1 #', 'land_cover.forest.bogus'],
    ['rivers', /^rivers:\n {2}seed: 31$/m, 'rivers:\n  bogus: 1\n  seed: 31', 'rivers.bogus'],
    ['rivers.items', /\{ id: rio-abajo, /, '{ bogus: 1, id: rio-abajo, ', 'rivers.items[0].bogus'],
    ['rivers.items.outlet', /outlet: \{ water_body: gatun-lake \}/, 'outlet: { water_body: gatun-lake, bogus: 1 }', 'rivers.items[3].outlet.bogus'],
    ['canal', /^canal:\n {2}route: canal /m, 'canal:\n  bogus: 1\n  route: canal ', 'canal.bogus'],
    ['canal.locks', /\{ id: miraflores, /, '{ bogus: 1, id: miraflores, ', 'canal.locks[0].bogus'],
    ['water_bodies', /^ {2}- id: gatun-lake\n/m, '  - id: gatun-lake\n    bogus: 1\n', 'water_bodies[0].bogus'],
    ['airports', /^ {2}- id: tocumen\n/m, '  - id: tocumen\n    bogus: 1\n', 'airports[0].bogus'],
    ['main_roads', /^main_roads:\n {2}params:/m, 'main_roads:\n  bogus: 1\n  params:', 'main_roads.bogus'],
    ['main_roads.params', /^ {4}sample_step: 25/m, '    bogus: 1\n    sample_step: 25', 'main_roads.params.bogus'],
    ['main_roads.nodes', /\{ id: west-gateway, /, '{ bogus: 1, id: west-gateway, ', 'main_roads.nodes[0].bogus'],
    ['main_roads.roads', /^ {4}- id: interamericana\n/m, '    - id: interamericana\n      bogus: 1\n', 'main_roads.roads[0].bogus'],
    ['main_roads.coastway', /^ {4}boulevard: cinta-costera /m, '    bogus: 1\n    boulevard: cinta-costera ', 'main_roads.coastway.bogus'],
    ['relief.ridges', /^ {4}- id: north-wall\n/m, '    - id: north-wall\n      bogus: 1\n', 'relief.ridges[0].bogus'],
    ['relief.upland', /^ {2}upland:\n/m, '  upland:\n    bogus: 1\n', 'relief.upland.bogus'],
    ['relief.grid.far', /far: \{ cell: 16 \}/, 'far: { cell: 16, bogus: 1 }', 'relief.grid.far.bogus'],
  ];
  for (const [name, from, to, expected] of cases) {
    const broken = yaml.replace(from, to);
    assert.notEqual(broken, yaml, `test setup: pattern for ${name} did not match`);
    expectProblem(broken, (p) => p.startsWith(expected) && p.includes('unknown key'));
  }
});

test('layer sections reject bad values: lake_level below sea, chain naming an unknown node, viaduct road that is not a viaduct', () => {
  expectProblem(yaml.replace('lake_level: 12', 'lake_level: -3'), (p) => p.startsWith('canal.lake_level'));
  expectProblem(yaml.replace('chain: [paitilla, cinta-east]', 'chain: [paitilla, nowhere]'), (p) => p.includes('unknown node "nowhere"'));
  expectProblem(yaml.replace(/^ {6}structure: viaduct\n/m, ''), (p) => p.includes('is not a road with structure: viaduct'));
  expectProblem(yaml.replace('far: { cell: 16 }', 'far: { cell: 3 }'), (p) => p.startsWith('relief.grid.far.cell'));
});
