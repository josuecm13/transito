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
