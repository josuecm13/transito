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
  assert.equal(corridor.style, 'section');
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
    yaml.replace(/^( {6}style:) section$/m, '$1 grid'),
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

test('relief and canal sections parse from world.yaml', () => {
  const spec = parseWorldSpec(yaml);
  assert.equal(spec.relief.grid.far.cell, 16);
  assert.ok(spec.relief.ridges.length >= 2);
  assert.equal(spec.canal.route, 'canal');
  assert.deepEqual(spec.canal.locks.map((l) => l.chamber), [[305, 34], [305, 34]]);
});

test('relief and canal sections are strict: an unknown key is rejected in each one', () => {
  const cases: [string, RegExp, string, string][] = [
    ['canal', /^canal:\n {2}route: canal /m, 'canal:\n  bogus: 1\n  route: canal ', 'canal.bogus'],
    ['canal.locks', /\{ id: miraflores, /, '{ bogus: 1, id: miraflores, ', 'canal.locks[0].bogus'],
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

test('layer sections reject bad values: lake_level below sea, a far grid cell that is too small', () => {
  expectProblem(yaml.replace('lake_level: 12', 'lake_level: -3'), (p) => p.startsWith('canal.lake_level'));
  expectProblem(yaml.replace('far: { cell: 16 }', 'far: { cell: 3 }'), (p) => p.startsWith('relief.grid.far.cell'));
});

test('procedural section parses with named stops, the corridor seeded along its route, Línea 2 as configured', () => {
  const spec = parseWorldSpec(yaml);
  const p = spec.procedural;
  assert.equal(p.cell, 20);
  assert.deepEqual(p.roads.routes.find((r) => r.id === 'interamericana')?.stops, ['balboa', 'city', 'corridor-east', 'airport-terminal']);
  assert.deepEqual(p.towns.items.find((t) => t.id === 'el-corredor')?.seedAlong, { route: 'interamericana', from: 'city', reach: 400 });
  // Two branches, no shared stop: one line or two is still the director's call (#12). `corridor-east` is a via point.
  assert.deepEqual(p.transit.lines.find((l) => l.id === 'linea-2')?.branches, [['balboa', 'casco', 'bay-east'], ['north', 'corridor-east', 'airport-terminal']]);
  assert.equal(p.transit.lines.find((l) => l.id === 'ferrocarril')?.mode, 'rail');
});

test('procedural section is strict: an unknown key is rejected at every level', () => {
  const cases: [string, RegExp, string, string][] = [
    ['procedural', /^procedural:\n {2}cell: 20 /m, 'procedural:\n  bogus: 1\n  cell: 20 ', 'procedural.bogus'],
    ['relief.zones', /\{ id: cordillera, kind: line, /, '{ id: cordillera, kind: line, bogus: 1, ', 'procedural.relief.zones[0].bogus'],
    ['relief.zones disc', /\{ id: lake-basin, kind: disc, /, '{ id: lake-basin, kind: disc, bogus: 1, ', 'procedural.relief.zones[6].bogus'],
    ['relief.modulation.octaves', /octaves: \{ wavelength: 1400, octaves: 5, gain: 0\.55 \}/, 'octaves: { wavelength: 1400, octaves: 5, gain: 0.55, bogus: 1 }', 'procedural.relief.modulation.octaves.bogus'],
    ['relief.erosion', /erosion: \{ iterations: 160, /, 'erosion: { bogus: 1, iterations: 160, ', 'procedural.relief.erosion.bogus'],
    ['lake', /^ {4}dam_hint: \[650, 6250\]/m, '    bogus: 1\n    dam_hint: [650, 6250]', 'procedural.lake.bogus'],
    ['airport.apron', /apron: \{ length: 520, /, 'apron: { bogus: 1, length: 520, ', 'procedural.airport.apron.bogus'],
    ['roads.grade.rail', /rail: \{ g0: 0\.03, /, 'rail: { bogus: 1, g0: 0.03, ', 'procedural.roads.grade.rail.bogus'],
    ['roads.routes', /\{ id: railroad, kind: rail, /, '{ id: railroad, kind: rail, bogus: 1, ', 'procedural.roads.routes[4].bogus'],
    ['towns.items', /\{ id: gamboa, seeds: /, '{ id: gamboa, bogus: 1, seeds: ', 'procedural.towns.items[4].bogus'],
    ['towns.items.seed_along', /seed_along: \{ route: interamericana, from: city, reach: 400 \}/, 'seed_along: { route: interamericana, from: city, reach: 400, bogus: 1 }', 'procedural.towns.items[3].seed_along.bogus'],
    ['cover.clearing', /clearing: \{ wavelength: 300, /, 'clearing: { bogus: 1, wavelength: 300, ', 'procedural.cover.clearing.bogus'],
    ['transit.lines', /\{ id: ferrocarril, /, '{ id: ferrocarril, bogus: 1, ', 'procedural.transit.lines[3].bogus'],
    ['transit.grade', /grade: \{ metro: 0\.06, /, 'grade: { bogus: 1, metro: 0.06, ', 'procedural.transit.grade.bogus'],
    ['towns.items.patches', /\{ id: gamboa, seeds: /, '{ id: gamboa, patches: { wavelength: 200, threshold: 0.4, bogus: 1 }, seeds: ', 'procedural.towns.items[4].patches.bogus'],
  ];
  for (const [name, from, to, expected] of cases) {
    const broken = yaml.replace(from, to);
    assert.notEqual(broken, yaml, `test setup: pattern for ${name} did not match`);
    expectProblem(broken, (p) => p.startsWith(expected) && p.includes('unknown key'));
  }
});

test('procedural section rejects broken references and values', () => {
  // A route or a line naming a stop that does not exist.
  expectProblem(yaml.replace('stops: [city-north, colon] }', 'stops: [city-north, nowhere] }'), (p) => p.startsWith('procedural.roads.routes[1].stops') && p.includes("'nowhere'"));
  expectProblem(yaml.replace('[north, corridor-east, airport-terminal]', '[north, corridor-east, tocumen]'), (p) => p.startsWith('procedural.transit.lines[1].branches[1]') && p.includes("'tocumen'"));
  // The reserved airport terminal id cannot be redefined as a stop.
  expectProblem(yaml.replace('      bay-east: [3800, 950]\n', '      bay-east: [3800, 950]\n      airport-terminal: [5000, 1800]\n'), (p) => p.startsWith('procedural.transit.stops.airport-terminal') && p.includes('reserved'));
  // A town needs exactly one of seeds / seed_along, and seed_along must start at a named stop of a road.
  expectProblem(yaml.replace('{ id: el-corredor, seed_along:', '{ id: el-corredor, seeds: [[4000, 1500]], seed_along:'), (p) => p.startsWith('procedural.towns.items[3]') && p.includes('exactly one'));
  expectProblem(yaml.replace('from: city, reach: 400 }', 'from: colon, reach: 400 }'), (p) => p.startsWith('procedural.towns.items[3].seed_along.from'));
  expectProblem(yaml.replace('from: city, reach: 400 }', 'from: city, reach: 0 }'), (p) => p.startsWith('procedural.towns.items[3].seed_along.reach'));
  expectProblem(yaml.replace('route: interamericana, from: city', 'route: railroad, from: balboa'), (p) => p.startsWith('procedural.towns.items[3].seed_along.route') && p.includes('railroad'));
  // Points outside the map, inverted ranges, bad colours, duplicate ids.
  expectProblem(yaml.replace('dam_hint: [650, 6250]', 'dam_hint: [650, 9250]'), (p) => p.startsWith('procedural.lake.dam_hint') && p.includes('outside the map'));
  expectProblem(yaml.replace('height_band: [60, 160]', 'height_band: [160, 60]'), (p) => p.startsWith('procedural.suitability.height_band'));
  expectProblem(yaml.replace('color: [150, 96, 196]', 'color: [150, 96, 300]'), (p) => p.startsWith('procedural.transit.lines[3].color'));
  expectProblem(yaml.replace('{ id: gamboa, seeds:', '{ id: colon, seeds:'), (p) => p.startsWith('procedural.towns.items') && p.includes("duplicate id 'colon'"));
  expectProblem(yaml.replace('runway_spacing: 260 ', 'runway_spacing: 30 '), (p) => p.startsWith('procedural.airport.runway_spacing'));
  // Composition: separation and airport buffer are non-negative; a patch threshold is a fraction.
  expectProblem(yaml.replace(/separation: \d+ /, 'separation: -5 '), (p) => p.startsWith('procedural.towns.separation'));
  expectProblem(yaml.replace(/airport_buffer: \d+ /, 'airport_buffer: -5 '), (p) => p.startsWith('procedural.towns.airport_buffer'));
  expectProblem(yaml.replace('{ id: gamboa, seeds:', '{ id: gamboa, patches: { wavelength: 200, threshold: 1.5 }, seeds:'), (p) => p.startsWith('procedural.towns.items[4].patches.threshold'));
});
