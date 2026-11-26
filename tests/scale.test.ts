import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec, WorldSpecError } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import { deriveCity, generateStreets } from '../src/world/streets/index.ts';
import { isWholeStoreys, storeyRange, streetScaleProblems, wholeLanes, wholeStoreyHeight } from '../src/world/scale.ts';
import { act1World } from './act1-world.ts';
import { TITO_BODY, bodyHeight } from '../src/sim/body.ts';

// Human scale (README "Human scale"): one fixed set of measures in `scale:`; everything generated obeys it.

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const spec = parseWorldSpec(yaml);
const { scale } = spec;

test('spec: scale: holds the human-sized measures', () => {
  assert.equal(scale.human, 1.8);
  assert.equal(scale.storey, 3);
  assert.deepEqual(scale.door, { width: 0.9, height: 2.1 });
  assert.deepEqual(scale.lane, [3, 3.75]);
  assert.equal(scale.sidewalkMin, 1.5);
  assert.deepEqual(scale.traffic, ['highway', 'arterial', 'road']);
  // One source for the storey: the frontage-lots fingerprint reads it from scale:.
  for (const d of Object.values(spec.blockout.districts)) if (d.frontageLots) assert.equal(d.frontageLots.levelHeight, scale.storey);
});

test('Tito is as tall as scale.human', () => {
  assert.ok(Math.abs(bodyHeight(TITO_BODY) - scale.human) < 1e-9, `TITO_BODY ${bodyHeight(TITO_BODY)} m vs scale.human ${scale.human} m`);
});

test('pure: whole lanes, storey ranges and rounding', () => {
  assert.equal(wholeLanes(3.5, [3, 3.75]), 1);
  assert.equal(wholeLanes(7, [3, 3.75]), 2);
  assert.equal(wholeLanes(24, [3, 3.75]), 7);
  assert.equal(wholeLanes(4.5, [3, 3.75]), null); // too wide for one lane, too narrow for two
  assert.equal(wholeLanes(2.5, [3, 3.75]), null);
  assert.deepEqual(storeyRange([20, 60], 3), [7, 20]);
  assert.deepEqual(storeyRange([4, 10], 3), [2, 3]);
  assert.equal(storeyRange([4, 5], 3), null);
  assert.equal(wholeStoreyHeight(41.3, [20, 60], 3), 42);
  assert.equal(wholeStoreyHeight(20.2, [20, 60], 3), 21); // rounds to 7 storeys, never below the range
  assert.equal(wholeStoreyHeight(13.9, [6, 14], 3), 12);
  assert.ok(isWholeStoreys(6, 3) && !isWholeStoreys(7.5, 3) && !isWholeStoreys(0, 3));
  assert.deepEqual(streetScaleProblems('x', { width: 9, sidewalk: 2 }, scale), []);
  assert.equal(streetScaleProblems('x', { width: 9, sidewalk: 1 }, scale).length, 1);
  assert.equal(streetScaleProblems('x', { width: 4.5, sidewalk: 0 }, scale).length, 1);
});

test('spec: broken scale rules are rejected', () => {
  const broken = (from: RegExp, to: string, why: RegExp): void => {
    const text = yaml.replace(from, to);
    assert.notEqual(text, yaml, `mutation ${from} must change the yaml`);
    assert.throws(() => parseWorldSpec(text), (e: unknown) => e instanceof WorldSpecError && why.test(e.message), String(from));
  };
  broken(/ storey: 3 /, ' storey: 2 ', /does not fit a 2\.1 m door/);
  broken(/lane: \[3\.0, 3\.75\]/, 'lane: [3.75, 3.0]', /scale\.lane/);
  broken(/local: {5}{ width: 7, /, 'local:     { width: 4.5, ', /hierarchy\.local\.width: 4\.5 m is not a whole number/);
  broken(/road: {5}{ width: 9, {2}sidewalk: 2 }/, 'road:     { width: 9,  sidewalk: 1 }', /street_profiles\.road\.sidewalk/);
  broken(/height: \[6, 14\]/, 'height: [4, 5]', /airport\.height: \[4, 5\] holds no whole 3 m storey/);
  broken(/traffic: \[highway, arterial, road\]/, 'traffic: [highway, arterial, street]', /unknown street_profiles kind "street"/);
  broken(/ sidewalk_min: 1\.5 /, ' sidewalk_min: 1.5 \n  storeys: 3\n', /scale\.storeys: unknown key/);
  broken(/two_storey_share: 0\.3 /, 'two_storey_share: 0.3\n        level_height: 3\n       ', /level_height: unknown key/);
});

// ------------------------------------------------------------------ what the game generates

const slice = sliceWorld(spec);
const net = generateStreets(spec, slice);
const city = deriveCity(spec, slice, net);

test('generated buildings are whole storeys inside their district range', () => {
  assert.ok(city.buildings.length > 1000, `${city.buildings.length} buildings`);
  const bad = city.buildings.filter((b) => {
    const [lo, hi] = spec.blockout.districts[b.district]!.height;
    const frontage = b.parcel === -1; // frontage lots draw 1–2 storeys from their fingerprint, not the range
    return !isWholeStoreys(b.height, scale.storey) || (!frontage && (b.height < lo || b.height > hi));
  });
  assert.equal(bad.length, 0, `${bad.length} buildings off-scale, e.g. ${bad.slice(0, 3).map((b) => `${b.district} ${b.height.toFixed(2)} m`).join(', ')}`);
  // Every parcel district really produces several storey counts (the rounding doesn't flatten them).
  for (const id of ['airport', 'costa-del-este']) {
    const storeys = new Set(city.buildings.filter((b) => b.district === id).map((b) => Math.round(b.height / scale.storey)));
    assert.ok(storeys.size >= 2, `${id}: ${[...storeys].join(', ')} storeys`);
  }
});

test('generated streets hold whole lanes and walkable sidewalks', () => {
  // The Act 1 build as the game makes it (derived spec + section profile), so El Corredor is really there.
  const game = act1World();
  const net = game.streets;
  const kindOf = new Map(game.spec.routes.map((r) => [r.id, r.kind]));
  let checked = 0;
  let corridorChecked = 0;
  const problems: string[] = [];
  for (const e of net.graph.edges) {
    if (e.cls === 'frame') continue;
    if (e.cls === 'avenue' && !scale.traffic.includes(kindOf.get(e.routeId ?? '') ?? '')) continue; // rail, runway, waterway
    checked++;
    if (e.district === 'tito-corridor') corridorChecked++;
    problems.push(...streetScaleProblems(`edge ${e.id} (${e.cls}${e.routeId ? ' ' + e.routeId : ''})`, e, scale));
  }
  // Non-vacuity guard, measured on the Act 1 build (derived spec + section profile): 671 edges checked, 442 of them
  // El Corredor's own local + alley streets. (The old `> 1000` only held because the retired grower filled the
  // corridor on the authored grid.) The rule is the `problems` assertion below; these only prove it saw the corridor.
  assert.ok(corridorChecked >= 300, `${corridorChecked} corridor street edges checked`);
  assert.ok(checked >= 600, `${checked} street edges checked`);
  assert.deepEqual(problems.slice(0, 5), []);
});
