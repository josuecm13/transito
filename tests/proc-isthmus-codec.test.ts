// #12 2.5 card F6: the game loads the isthmus baked at build time (tools/bake-isthmus.ts) instead of
// generating it at startup. The bake must give back exactly the generated isthmus and the same world.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWorldSpec } from '../src/world/spec.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { decodeIsthmus, encodeIsthmus } from '../src/world/proc/isthmus-codec.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { assertSameData } from './determinism.ts';
import { dirname, join, resolve } from 'node:path';
import { inputFiles } from '../tools/vite-isthmus.ts';

const yaml = readFileSync(new URL('../specs/map/world.yaml', import.meta.url), 'utf8');
const iso = generateIsthmus(parseWorldSpec(yaml));
const bytes = encodeIsthmus(iso);
const back = decodeIsthmus(bytes);

test('round trip: the decoded isthmus is deep-equal to the generated one (typed arrays by type and content)', () => {
  assert.deepStrictEqual(back, iso);
  // Re-encoding gives the same bytes: the bake is byte-stable.
  assert.equal(Buffer.compare(Buffer.from(encodeIsthmus(back)), Buffer.from(bytes)), 0);
});

test('the world built on the decoded isthmus is the world built on the generated one', () => {
  // slice.isPlayableLand is a closure (one per call), so compare everything else.
  const strip = (d: ReturnType<typeof buildWorldData>) => ({ ...d, slice: { ...d.slice, isPlayableLand: undefined } });
  assertSameData(strip(buildWorldData(yaml, back)), strip(buildWorldData(yaml, iso)), 'buildWorldData(baked) vs buildWorldData(generated)');
});

test('values JSON cannot carry survive: -0, NaN, ±Infinity, undefined (in objects and arrays), every typed array type', () => {
  const odd = {
    z: -0, n: NaN, p: Infinity, m: -Infinity, u: undefined, list: [1, undefined, -0, null],
    f64: new Float64Array([0.1, -0, NaN]), f32: new Float32Array([1.5]), i32: new Int32Array([-7, 3]), u8: new Uint8Array([255]),
    i16: new Int16Array([-2]), u16: new Uint16Array([9]), i8: new Int8Array([-1]), u32: new Uint32Array([4e9]), c8: new Uint8ClampedArray([3]),
  };
  const out = decodeIsthmus(encodeIsthmus(odd as unknown as Isthmus)) as unknown as typeof odd;
  assert.deepStrictEqual(out, odd);
  assert.ok(Object.is(out.z, -0) && Object.hasOwn(out, 'u'));
  for (const k of ['f64', 'i32'] as const) assert.equal(out[k].byteOffset % 8, 0, `${k} aligned`);
});

test('anything but an isthmus file is rejected', () => {
  assert.throws(() => decodeIsthmus(new Uint8Array(16)), /not an isthmus file/);
  assert.throws(() => encodeIsthmus({ when: new Date(0) } as unknown as Isthmus), /unsupported Date/);
});

test('the bake key covers the generator: every module isthmus.ts imports (transitively) is a hashed input', () => {
  const root = join(import.meta.dirname, '..');
  const inputs = new Set(inputFiles(root));
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    assert.ok(inputs.has(file), `${file.slice(root.length + 1)} is imported by the generator but not hashed: a change there would not rebake`);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'/g)) {
      const spec = m[1]!;
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
    }
  };
  visit(join(root, 'src/world/proc/isthmus.ts'));
  visit(join(root, 'src/world/spec.ts'));
  assert.ok(seen.size > 10, `walked ${seen.size} modules`);
});
