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
