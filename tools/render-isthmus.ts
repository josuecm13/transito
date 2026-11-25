#!/usr/bin/env node
/**
 * Renders the procedural isthmus (src/world/proc/) to a PNG for visual review against the vision image.
 *
 *   node tools/render-isthmus.ts [--out .cache/isthmus.png] [--mpp 5] [--cell 20]
 *
 * Output is gitignored (.cache/). Pure pipeline: same spec + params, same image.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITS_FILE, parseWorldWithEdits } from '../src/studio/saved.ts';
import { generateIsthmus, isthmusRenderInput } from '../src/world/proc/isthmus.ts';
import { encodePng } from '../src/world/proc/png.ts';
import { renderMap } from '../src/world/proc/render.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
};
const outArg = arg('out', '.cache/isthmus.png');
const out = isAbsolute(outArg) ? outArg : join(ROOT, outArg);
const mpp = Number(arg('mpp', '5'));
const cell = Number(arg('cell', '20'));

const spec = parseWorldWithEdits(readFileSync(join(ROOT, 'specs/map/world.yaml'), 'utf8'), existsSync(join(ROOT, EDITS_FILE)) ? readFileSync(join(ROOT, EDITS_FILE), 'utf8') : undefined);
const t0 = performance.now();
const iso = generateIsthmus(spec, { cell });
const t1 = performance.now();
const img = renderMap(isthmusRenderInput(iso), { metresPerPixel: mpp, exaggeration: 2.2, seed: 5 });
const t2 = performance.now();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, encodePng(img.width, img.height, img.rgb));
console.log(`generate ${(t1 - t0).toFixed(0)} ms, render ${(t2 - t1).toFixed(0)} ms -> ${out} (${img.width}x${img.height})`);
for (const line of iso.report) console.log(line);
