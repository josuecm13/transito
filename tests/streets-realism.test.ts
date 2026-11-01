/**
 * Realism: each formal, non-exempt district of the active area must fall inside the band of its
 * reference sectors (specs/map/street-metrics.yaml: references + band.default + band.overrides).
 * Informal districts get their streets in S4 and are checked there.
 *
 * Area normalization ('cells'): the references' km² is st_area(bbox) and the engine polygonizes
 * roads + the bbox ring, so a reference's per-km² densities count every part of its box (Santa
 * Ana's enclosed blocks cover only 3.62 of its 9.86 km²: the rest is bay and clipped edges). The
 * analogue for a district is its grid cells inside the active area, sea included. Measured per
 * km² of playable land instead, densities come out ~1.35× higher (printed below for reference).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { WorldSpec } from '../src/world/spec.ts';
import { parseWorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import type { StreetMetrics } from '../src/world/street-metrics.ts';
import { generateStreets, measureDistrict } from '../src/world/streets/index.ts';

type Band = {
  block_area_median_rel: number;
  block_area_p90_rel: number;
  node_share_abs: number;
  intersections_per_km2_rel: number;
  street_km_per_km2_rel: number;
};
type MetricsFile = {
  references: Record<string, { metrics: StreetMetrics }>;
  band: { default: Band; overrides?: Record<string, Partial<Band>> };
};

const root = join(import.meta.dirname, '..');
const spec = parseWorldSpec(readFileSync(join(root, 'specs/map/world.yaml'), 'utf8'));
const metricsFile = load(readFileSync(join(root, 'specs/map/street-metrics.yaml'), 'utf8')) as MetricsFile;

/** Band violations of `m` against reference `name` (empty = inside the band). */
function bandViolations(m: StreetMetrics, name: string, file: MetricsFile = metricsFile): string[] {
  const ref = file.references[name]?.metrics;
  if (!ref) return [`no frozen reference "${name}" in street-metrics.yaml`];
  const band: Band = { ...file.band.default, ...(file.band.overrides?.[name] ?? {}) };
  const out: string[] = [];
  const rel = (k: keyof StreetMetrics, tol: number) => {
    const d = Math.abs(m[k] - ref[k]) / ref[k];
    if (!(d <= tol)) out.push(`${k}: ${m[k].toFixed(3)} vs ${ref[k].toFixed(3)} (±${tol * 100}%, off by ${(d * 100).toFixed(1)}%)`);
  };
  rel('block_area_median_m2', band.block_area_median_rel);
  rel('block_area_p90_m2', band.block_area_p90_rel);
  rel('intersections_per_km2', band.intersections_per_km2_rel);
  rel('street_km_per_km2', band.street_km_per_km2_rel);
  for (const k of ['dead_end_share', 't_share', 'x_share'] as const) {
    const d = Math.abs(m[k] - ref[k]);
    if (!(d <= band.node_share_abs)) out.push(`${k}: ${m[k].toFixed(3)} vs ${ref[k].toFixed(3)} (±${band.node_share_abs * 100} pts)`);
  }
  return out;
}

/** Formal, non-exempt districts with a street style and land inside the active area. */
function formalDistricts(s: WorldSpec): string[] {
  return Object.entries(s.streetStyles.districts)
    .filter(([, st]) => st.style === 'formal' && st.realismExemptReason === undefined)
    .map(([id]) => id)
    .sort();
}

function violationsFor(s: WorldSpec): Record<string, string[]> {
  const slice = sliceWorld(s);
  const net = generateStreets(s, slice);
  const out: Record<string, string[]> = {};
  for (const id of formalDistricts(s)) {
    const m = measureDistrict(net, s, slice.rect, id, { area: 'cells' });
    const land = measureDistrict(net, s, slice.rect, id, { area: 'land' });
    const fmt = (x: StreetMetrics) =>
      `blocks=${x.blocks_measured} median=${x.block_area_median_m2.toFixed(0)} p90=${x.block_area_p90_m2.toFixed(0)} ` +
      `dead=${(x.dead_end_share * 100).toFixed(1)}% T=${(x.t_share * 100).toFixed(1)}% X=${(x.x_share * 100).toFixed(1)}% ` +
      `int/km2=${x.intersections_per_km2.toFixed(1)} km/km2=${x.street_km_per_km2.toFixed(2)}`;
    console.log(`# ${id} (cells): ${fmt(m)}`);
    console.log(`# ${id} (land):  ${fmt(land)}`);
    const style = s.streetStyles.districts[id]!;
    out[id] = style.reference.flatMap((ref) => bandViolations(m, ref.name).map((v) => `${ref.name}: ${v}`));
  }
  return out;
}

test('formal districts of the active area fall inside their reference band', () => {
  const ids = formalDistricts(spec);
  assert.ok(ids.includes('costa-del-este'), 'costa-del-este is checked');
  const v = violationsFor(spec);
  for (const id of ids) assert.deepEqual(v[id], [], `${id} out of band`);
});

test('negative control: the band rejects a coarser layout (spacing.local × 3 in a test-local spec copy)', () => {
  const coarse = structuredClone(spec);
  const st = coarse.streetStyles.districts['costa-del-este']!;
  assert.equal(st.style, 'formal');
  if (st.style === 'formal') st.spacing.local *= 3;
  const v = violationsFor(coarse);
  assert.ok((v['costa-del-este'] ?? []).length > 0, 'a ×3 local spacing must leave the band');
});
