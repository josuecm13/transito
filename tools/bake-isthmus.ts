// Bakes the procedural isthmus of specs/map/world.yaml to a binary file (src/world/proc/isthmus-codec.ts).
// Usage: node --max-old-space-size=1536 tools/bake-isthmus.ts <out.bin>
// Run by the Vite plugin (tools/vite-isthmus.ts); deterministic: same spec + code → same bytes.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import { encodeIsthmus } from '../src/world/proc/isthmus-codec.ts';

const out = process.argv[2];
if (!out) {
  console.error('usage: bake-isthmus.ts <out.bin>');
  process.exit(2);
}
const t0 = performance.now();
const spec = parseWorldSpec(readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8'));
const bytes = encodeIsthmus(generateIsthmus(spec));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.tmp`, bytes);
// Rename last, so a half-written file is never taken for a bake.
renameSync(`${out}.tmp`, out);
console.log(`[bake-isthmus] ${(bytes.length / 1e6).toFixed(1)} MB in ${(performance.now() - t0).toFixed(0)} ms → ${out}`);
