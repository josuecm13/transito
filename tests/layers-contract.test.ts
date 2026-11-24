import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import {
  layer1LandCover,
  layer2Relief,
  layer3Water,
  layer4Airports,
  layer5MainRoads,
  runLayers,
} from '../src/world/layers/index.ts';

const dir = join(import.meta.dirname, '../src/world/layers');
const spec = parseWorldSpec(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));

const layerFiles = readdirSync(dir).filter((f) => /^layer\d+-.*\.ts$/.test(f)).sort();
const layerNo = (f: string): number => Number(/^layer(\d+)-/.exec(f)?.[1]);

/** Every module specifier in a source file: import/export ... from, side-effect imports, dynamic import(). */
function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) out.push(m[1] as string);
  return out;
}

/** Layer-contract violations of one file's source: later layers or the index (which imports them all). */
export function contractViolations(file: string, src: string): string[] {
  const n = layerNo(file);
  const bad: string[] = [];
  for (const s of specifiers(src)) {
    const base = s.split('/').pop() ?? '';
    const m = /^layer(\d+)-/.exec(base);
    if (m && Number(m[1]) > n) bad.push(`layer ${n} (${file}) imports layer ${m[1]} ("${s}")`);
    if (s.startsWith('.') && /^index(\.ts)?$/.test(base) && !s.startsWith('../')) bad.push(`${file} imports the layers index ("${s}")`);
  }
  return bad;
}

test('layer files are numbered 1..5 with no gap', () => {
  assert.deepEqual(layerFiles.map(layerNo), [1, 2, 3, 4, 5]);
});

test('layer N imports nothing from layers > N (static scan of src/world/layers)', () => {
  const bad = layerFiles.flatMap((f) => contractViolations(f, readFileSync(join(dir, f), 'utf8')));
  assert.deepEqual(bad, [], `layer contract violations:\n${bad.join('\n')}`);
});

test('the scanner flags a later-layer import (guard fires on a synthetic violation)', () => {
  const bad = contractViolations('layer2-relief.ts', "import type { Layer5Output } from './layer5-main-roads.ts';");
  assert.equal(bad.length, 1);
  assert.deepEqual(contractViolations('layer2-relief.ts', "import type { Layer1Output } from './layer1-land-cover.ts';"), []);
});

test('layers stay pure: no I/O, clock or randomness', () => {
  for (const f of layerFiles) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.ok(!/node:|\bfs\b|Math\.random|Date\.now|new Date|performance\.now|\bfetch\(/.test(src), `${f} is not pure`);
  }
});

test('each layer runs given only the outputs of earlier layers', () => {
  const layer1 = layer1LandCover(spec);
  assert.equal(layer1.layer, 1);
  const layer2 = layer2Relief(spec, { layer1 });
  assert.equal(layer2.layer, 2);
  const layer3 = layer3Water(spec, { layer1, layer2 });
  assert.equal(layer3.layer, 3);
  const layer4 = layer4Airports(spec, { layer1, layer2, layer3 });
  assert.equal(layer4.layer, 4);
  const layer5 = layer5MainRoads(spec, { layer1, layer2, layer3, layer4 });
  assert.equal(layer5.layer, 5);
  assert.deepEqual(runLayers(spec), { layer1, layer2, layer3, layer4, layer5 });
});

test('layers are deterministic and do not mutate the spec', () => {
  const before = JSON.stringify(spec);
  assert.deepEqual(runLayers(spec), runLayers(spec));
  assert.equal(JSON.stringify(spec), before);
});
