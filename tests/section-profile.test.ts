// Card 3a: the El Corredor section profile (specs/map/sections/el-corredor.json) loads and every validation rule fires.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadSectionProfiles, parseSectionProfile, parseWorldSpec, WorldSpecError } from '../src/world/spec.ts';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const yaml = read('specs/map/world.yaml');
const spec = parseWorldSpec(yaml);
const FILE = 'specs/map/sections/el-corredor.json';
const text = read(FILE);

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Problems of a copy of the real profile after `mut` broke it. */
const problemsOf = (mut: (p: J) => void): string[] => {
  const p = JSON.parse(text) as J;
  mut(p);
  return parseSectionProfile(JSON.stringify(p), spec).problems;
};
const expectProblem = (mut: (p: J) => void, why: RegExp): void => {
  const probs = problemsOf(mut);
  assert.ok(probs.some((m) => why.test(m)), `expected ${why}, got: ${JSON.stringify(probs)}`);
};

test('the real profile is referenced from world.yaml, loads and validates with no problems', () => {
  assert.deepEqual(spec.sectionProfiles, { 'el-corredor': FILE });
  assert.deepEqual(parseSectionProfile(text, spec).problems, []);
  const loaded = loadSectionProfiles(spec, read);
  assert.equal(loaded['el-corredor']!.district, 'tito-corridor');
  assert.ok(JSON.stringify(JSON.parse(text)).indexOf('[[') < 0, 'no coordinates');
});

test('calibration reference is San Miguelito (torrijos-carter) and no range lists a la-carpio fragment', () => {
  const p = JSON.parse(text) as J;
  assert.equal(p.provenance.reference_fragment, 'torrijos-carter');
  for (const [k, v] of Object.entries(p.range as J)) {
    assert.ok(!(v.fragments as string[]).some((f) => f.startsWith('la-carpio')), `range.${k} lists a la-carpio fragment`);
  }
});

test('loader: a profile whose id differs from its world.yaml key is rejected', () => {
  const bad = { ...spec, sectionProfiles: { other: FILE } };
  assert.throws(() => loadSectionProfiles(bad, read), (e: unknown) => e instanceof WorldSpecError && /does not match section_profiles key/.test(e.message));
});

test('required fields', () => {
  for (const k of ['id', 'district', 'provenance', 'boundary', 'ports', 'network', 'blocks', 'range']) {
    expectProblem((p) => { delete p[k]; }, new RegExp(`${k}: required field missing`));
  }
});

test('p10 <= p50 <= p90 for every percentile quantity', () => {
  expectProblem((p) => { p.network.segment_length_m.p10 = 999; }, /network\.segment_length_m: expected p10 <= p50 <= p90/);
  expectProblem((p) => { p.network.min_junction_angle_deg.p90 = 1; }, /network\.min_junction_angle_deg: expected p10 <= p50 <= p90/);
  expectProblem((p) => { p.blocks.area_m2.p50 = 1e9; }, /blocks\.area_m2: expected p10 <= p50 <= p90/);
  expectProblem((p) => { p.blocks.elongation.p50 = 0; }, /blocks\.elongation: expected p10 <= p50 <= p90/);
});

test('openings: integers, 0 <= min <= max <= 2', () => {
  const why = /boundary\.openings: expected integers 0 <= min <= max <= 2/;
  expectProblem((p) => { p.boundary.openings.max = 3; }, why);
  expectProblem((p) => { p.boundary.openings = { min: 2, max: 1 }; }, why);
  expectProblem((p) => { p.boundary.openings.max = 1.5; }, why);
  expectProblem((p) => { p.boundary.openings.min = -1; }, why);
});

test('orientation shares are in (0, 1] and sum to at most 1', () => {
  expectProblem((p) => { p.network.orientation_families[0].share = 0; }, /orientation_families\[0\]\.share: must be in \(0, 1\]/);
  expectProblem((p) => { p.network.orientation_families[0].share = 1.2; }, /orientation_families\[0\]\.share: must be in \(0, 1\]/);
  expectProblem((p) => { p.network.orientation_families[0].share = 0.9; }, /shares sum to .* expected <= 1/);
});

test('junction_mix shares sum to 1 (+-0.01)', () => {
  expectProblem((p) => { p.network.junction_mix.t = 0.7; }, /junction_mix: dead_end \+ t \+ x must sum to 1/);
  assert.deepEqual(problemsOf((p) => { p.network.junction_mix.t += 0.005; }), [], 'inside the tolerance');
});

test('the district must exist in the spec', () => {
  expectProblem((p) => { p.district = 'nowhere'; }, /district: unknown district "nowhere"/);
});

test('ports: class must be a street class of the spec, width > 0', () => {
  expectProblem((p) => { p.ports.default_class = 'residential'; }, /ports\.default_class: expected one of/);
  expectProblem((p) => { p.ports.width_m = 0; }, /ports\.width_m: expected a number > 0/);
});

test('no negative or non-numeric numbers', () => {
  expectProblem((p) => { p.network.street_km_per_km2 = -1; }, /street_km_per_km2: must be a finite number >= 0/);
  expectProblem((p) => { p.range.street_km_per_km2.min = -5; }, /range\.street_km_per_km2\.min: must be a finite number >= 0/);
  expectProblem((p) => { p.network.intersections_per_km2 = 'many'; }, /network\.intersections_per_km2: expected a number/);
  const nan = text.replace('"street_km_per_km2": 19.51', '"street_km_per_km2": NaN');
  assert.notEqual(nan, text);
  assert.ok(parseSectionProfile(nan, spec).problems.some((m) => /JSON syntax/.test(m)));
});

test('style: informal was retired: it fails and names the section profile as the replacement', () => {
  const broken = yaml.replace(/^( {6}style:) section$/m, '$1 informal');
  assert.notEqual(broken, yaml, 'mutation did not apply');
  assert.throws(
    () => parseWorldSpec(broken),
    (e: unknown) => e instanceof WorldSpecError && e.problems.some((m) => /tito-corridor\.style/.test(m) && /retired/.test(m) && /section profile/.test(m)),
  );
});

test('style: section without a section profile for that district fails clearly', () => {
  const noProfile = { ...spec, sectionProfiles: {} };
  assert.throws(
    () => loadSectionProfiles(noProfile, read),
    (e: unknown) => e instanceof WorldSpecError && e.problems.some((m) => /tito-corridor/.test(m) && /style: section needs a section profile/.test(m)),
  );
  assert.ok(loadSectionProfiles(spec, read)['el-corredor'], 'with the profile it loads');
});
