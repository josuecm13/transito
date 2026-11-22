/**
 * Reference bake (tools/bake-refs-lib.ts): determinism from recorded Overpass fixtures, provenance,
 * metrics recompute, size budget. Offline: no network.
 * The determinism guard was mutation-checked (feature sort dropped -> the shuffled-order test went red).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { CoverZoneFile, OverpassJson, RefFile } from '../tools/bake-refs-lib.ts';
import { COVER_ZONES, REF_SPECS, bakeCover, bakeRef, clipRing, computeMetrics, lengthM, ringAreaM2, serializeRef, simplifyDP } from '../tools/bake-refs-lib.ts';

const root = join(import.meta.dirname, '..');
const refsDir = join(root, 'specs/map/refs');
const fx = (n: string): OverpassJson => JSON.parse(readFileSync(join(root, 'tests/fixtures', n), 'utf8'));
const runways = fx('overpass-tocumen-runways.json');
const rivers = fx('overpass-rios-matias-curundu.json');
const spec = (id: string) => REF_SPECS.find((s) => s.id === id)!;
const shuffled = (d: OverpassJson): OverpassJson => ({ ...d, elements: d.elements.slice().reverse() });

test('bake from the Overpass runway fixture: two runs are byte-identical', () => {
  const a = serializeRef(bakeRef(spec('tocumen-runways'), runways, '2026-11-22'));
  const b = serializeRef(bakeRef(spec('tocumen-runways'), runways, '2026-11-22'));
  assert.equal(a, b);
  assert.ok(a.endsWith('\n'));
});

test('bake output does not depend on the order Overpass returns elements', () => {
  for (const [id, data] of [['tocumen-runways', runways], ['rivers-pacific', rivers]] as const) {
    assert.ok(data.elements.length >= 2, `${id} fixture needs several elements`);
    assert.equal(serializeRef(bakeRef(spec(id), data, '2026-11-22')), serializeRef(bakeRef(spec(id), shuffled(data), '2026-11-22')), id);
  }
});

test('baked ref carries provenance, attribution and sorted keys', () => {
  const ref = bakeRef(spec('tocumen-runways'), runways, '2026-11-22');
  const p = ref.provenance;
  assert.equal(p.attribution, '© OpenStreetMap contributors');
  assert.match(p.licence, /ODbL/);
  assert.match(p.query, /aeroway/);
  assert.equal(p.date, '2026-11-22');
  assert.deepEqual(p.bbox, spec('tocumen-runways').bbox);
  const ids = ref.features.map((f) => f.id);
  assert.deepEqual(ids, ids.slice().sort((a, b) => a - b));
  const text = serializeRef(ref);
  assert.ok(text.indexOf('"attribution"') < text.indexOf('"bbox"') && text.indexOf('"bbox"') < text.indexOf('"date"'));
});

test('simplify keeps the ends, drops points within 20 m and keeps real corners', () => {
  const line: [number, number][] = [[-79.5, 9], [-79.49, 9.00001], [-79.48, 9], [-79.48, 9.01]];
  const s = simplifyDP(line, 20);
  assert.deepEqual(s, [[-79.5, 9], [-79.48, 9], [-79.48, 9.01]]);
  assert.ok(Math.abs(lengthM(s) - lengthM(line)) < 5);
});

test('runway fixture: Tocumen runways are about 3.06 km and 2.4-2.7 km at bearing about 30 deg (source: OSM ways 26509209, 26509273)', () => {
  const m = computeMetrics({ 'tocumen-runways': bakeRef(spec('tocumen-runways'), runways, '2026-11-22') }, {}) as { runways: { ways: { id: number; length_m: number; bearing_deg: number }[] } };
  const long = m.runways.ways.find((w) => w.id === 26509209)!;
  assert.ok(long.length_m > 3000 && long.length_m < 3100, String(long.length_m));
  for (const w of m.runways.ways) assert.ok(w.bearing_deg > 28 && w.bearing_deg < 32, `${w.id} ${w.bearing_deg}`);
});

test('river fixture: tortuosity above 1 and the same on recompute', () => {
  const refs = { 'rivers-pacific': bakeRef(spec('rivers-pacific'), rivers, '2026-11-22') };
  const a = computeMetrics(refs, {});
  const b = computeMetrics(refs, {});
  assert.deepEqual(a, b);
  const per = (a.rivers['rivers-pacific'] as { rivers: Record<string, { tortuosity: number }> }).rivers;
  assert.ok(per['Río Matías Hernández']!.tortuosity > 1.1);
  assert.ok(per['Río Curundú']!.tortuosity > 1);
});

test('land cover: clip and area of a synthetic square, share counts only closed ways', () => {
  const ring: [number, number][] = [[-79.51, 9.0], [-79.49, 9.0], [-79.49, 9.02], [-79.51, 9.02], [-79.51, 9.0]];
  const half = clipRing(ring, [9.0, -79.5, 9.02, -79.4]);
  assert.ok(Math.abs(ringAreaM2(half) / ringAreaM2(ring.slice(0, -1)) - 0.5) < 1e-9);
  const zone = { ...COVER_ZONES[0]!, bbox: [9.0, -79.5, 9.02, -79.4] as [number, number, number, number] };
  const g = ring.map(([lon, lat]) => ({ lat, lon }));
  const data: OverpassJson = { elements: [
    { type: 'way', id: 2, tags: { natural: 'wood' }, geometry: g },
    { type: 'way', id: 1, tags: { natural: 'wood' }, geometry: g.slice(0, 3) }, // open way: ignored
  ] };
  const c = bakeCover(zone, data, '2026-11-22');
  assert.equal(c.polygons.forest, 1);
  assert.ok(Math.abs(c.classes_km2.forest! - (ringAreaM2(half) / 1e6)) < 0.001);
  assert.equal(JSON.stringify(bakeCover(zone, data, '2026-11-22')), JSON.stringify(bakeCover(zone, { elements: data.elements.slice().reverse() }, '2026-11-22')));
});

test('committed refs: each has provenance + attribution, ids match the catalogue, total under 1 MB', () => {
  let total = 0;
  const walk = (d: string): void => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else total += s.size; } };
  walk(refsDir);
  assert.ok(total < 1_000_000, `refs total ${total} bytes`);
  for (const s of REF_SPECS) {
    const ref = JSON.parse(readFileSync(join(refsDir, `${s.id}.json`), 'utf8')) as RefFile;
    assert.equal(ref.id, s.id);
    assert.equal(ref.provenance.attribution, '© OpenStreetMap contributors');
    assert.match(ref.provenance.licence, /ODbL/);
    assert.ok(ref.provenance.query.length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(ref.provenance.date));
    assert.ok(ref.features.length > 0, `${s.id} has no features`);
  }
});

test('metrics.yaml equals a recompute from the committed unwarped refs (identical numbers)', () => {
  const refs: Record<string, RefFile> = {};
  for (const s of REF_SPECS) refs[s.id] = JSON.parse(readFileSync(join(refsDir, `${s.id}.json`), 'utf8'));
  const cover: Record<string, CoverZoneFile> = {};
  for (const z of COVER_ZONES) cover[z.id] = JSON.parse(readFileSync(join(refsDir, `landcover-${z.id}.json`), 'utf8'));
  const fresh = JSON.parse(JSON.stringify(computeMetrics(refs, cover)));
  assert.deepEqual(fresh, JSON.parse(JSON.stringify(computeMetrics(refs, cover))));
  const frozen = load(readFileSync(join(refsDir, 'metrics.yaml'), 'utf8'));
  assert.deepEqual(frozen, fresh);
  for (const id of ['interamericana', 'corredor-sur', 'autopista-panama-colon', 'transistmica']) {
    const t = (fresh.roads[id] as { main_path: { tortuosity: number } }).main_path.tortuosity;
    assert.ok(t >= 1 && t < 2, `${id} tortuosity ${t}`);
  }
});
