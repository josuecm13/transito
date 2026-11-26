// Card 1 (docs/map-reshape/03-technical/12-sectors-and-streaming.md 8.4): the Act 1 airfield sits on earth
// embankments with a limited slope instead of a 150 m blend that left cliffs. Measured on the generated isthmus
// with the saved Map Studio edits (the map the game uses).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { fieldDistance } from '../src/world/proc/airport.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { GUARDS } from '../src/studio/guards.ts';
import { parseWorldWithEdits } from '../src/studio/saved.ts';
import type { ProceduralSpec } from '../src/world/spec.ts';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const spec = parseWorldWithEdits(read('specs/map/world.yaml'), read('specs/map/procedural-edits.json'));
let graded: Isthmus;
let legacy: Isthmus;
let legacyCfg: ProceduralSpec;

before(() => {
  graded = generateIsthmus(spec);
  legacyCfg = { ...spec.procedural, airport: { ...spec.procedural.airport, gradeSlopeMax: 0 } };
  legacy = generateIsthmus(spec, { config: legacyCfg });
});

/** Steepest step (rise/run) between adjacent cells over the ring from the field out to `out` metres of the field edge. */
function maxRingSlope(iso: Isthmus, out: number): number {
  const { w, h, cell, data } = iso.height;
  const d = (i: number) => fieldDistance(iso.airport, ((i % w) + 0.5) * cell, (Math.floor(i / w) + 0.5) * cell);
  let worst = 0;
  for (let gy = 0; gy < h; gy++)
    for (let gx = 0; gx < w; gx++) {
      const i = gy * w + gx;
      if (d(i) > out) continue;
      for (const [ox, oy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
        const x = gx + ox;
        const y = gy + oy;
        if (x >= w || y < 0 || y >= h) continue;
        const j = y * w + x;
        if (d(j) > out) continue;
        worst = Math.max(worst, Math.abs(data[j]! - data[i]!) / (cell * Math.hypot(ox, oy)));
      }
    }
  return worst;
}

const A = () => spec.procedural.airport;

test('(a) the embankment ring never exceeds grade_slope_max, and the guard agrees', () => {
  const limit = A().gradeSlopeMax;
  assert.ok(limit > 0, 'the spec must have grading on');
  // The slope limit holds out to 75 % of the reach; the rest is the fade back to the natural ground.
  const slope = maxRingSlope(graded, A().gradeReachMax * 0.75);
  assert.ok(slope <= limit * 1.02, `ring slope ${slope.toFixed(3)} > ${limit}`);
  assert.equal(GUARDS['airport-pad-floats']!({ iso: graded, config: spec.procedural, metrics: undefined as never }), undefined);
});

test('(b) the pad is exactly level everywhere inside the field', () => {
  const { w, h, cell, data } = graded.height;
  let n = 0;
  for (let gy = 0; gy < h; gy++)
    for (let gx = 0; gx < w; gx++) {
      if (fieldDistance(graded.airport, (gx + 0.5) * cell, (gy + 0.5) * cell) > 0) continue;
      n++;
      assert.equal(data[gy * w + gx], graded.airport.level);
    }
  assert.ok(n > 1000, `field cells ${n}`);
});

test('(c) the field, runways and heading are where they were before grading', () => {
  const a = graded.airport;
  assert.equal(Math.round(a.centre.x), 5019);
  assert.equal(Math.round(a.centre.y), 2858);
  assert.equal(Math.round((Math.atan2(a.dir.x, a.dir.y) * 180) / Math.PI), 10);
  assert.ok(Math.abs(a.level - 38.05) < 0.01);
  const before = [[5042.836, 2244.541, 5251.214, 3426.310], [4786.786, 2289.690, 4995.164, 3471.459]];
  a.runways.forEach((r, k) => [r.a.x, r.a.y, r.b.x, r.b.y].forEach((v, m) => assert.ok(Math.abs(v - before[k]![m]!) < 0.01, `runway ${k}[${m}] ${v}`)));
  // Siting does not depend on the grading, so the legacy map has the identical field.
  assert.deepEqual(legacy.airport.field, a.field);
  assert.deepEqual(legacy.airport.runways, a.runways);
});

test('(d) the legacy blend (grade_slope_max 0) steps far past the limit, so (a) is not vacuous', () => {
  const limit = A().gradeSlopeMax;
  const slope = maxRingSlope(legacy, 150);
  assert.ok(slope > limit * 3, `legacy ring slope ${slope.toFixed(3)}`);
  assert.match(GUARDS['airport-pad-floats']!({ iso: legacy, config: legacyCfg, metrics: undefined as never }) ?? '', /legacy/);
  // The legacy ground judged against the real limit: the guard measures the height steps, it does not trust the setting.
  assert.match(GUARDS['airport-pad-floats']!({ iso: legacy, config: spec.procedural, metrics: undefined as never }) ?? '', /embankment is [\d.]+ m\/m steep/);
});
