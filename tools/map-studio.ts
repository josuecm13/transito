#!/usr/bin/env node
/**
 * Map Studio CLI (#13): one JSON request on stdin (or --file), one JSON response on stdout.
 *
 *   echo '{"op":"describe"}' | node tools/map-studio.ts
 *   echo '{"op":"patch","dryRun":true,"changes":[{"path":"procedural.lake.target_km2","value":5.8}]}' | node tools/map-studio.ts
 *   echo '{"op":"preview","out":".cache/studio/preview.png"}' | node tools/map-studio.ts
 *
 * Working edits live in .cache/studio/working.json between calls (`reset` clears them); `save` writes them to
 * specs/map/procedural-edits.json, which every map tool applies on top of world.yaml (src/studio/saved.ts).
 * Exit code 0 when `ok`, 1 otherwise; the JSON is on stdout either way.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/world/proc/png.ts';
import { handle, openBase, type Request, type State } from '../src/studio/protocol.ts';
import { EDITS_FILE, parseEdits, serialiseEdits } from '../src/studio/saved.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKING = join(ROOT, '.cache/studio/working.json');

function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

const fileArg = process.argv.indexOf('--file');
const raw = fileArg > 0 ? readFileSync(process.argv[fileArg + 1]!, 'utf8') : readFileSync(0, 'utf8');
let req: Request & { out?: string };
try {
  req = JSON.parse(raw) as Request & { out?: string };
} catch (e) {
  console.log(JSON.stringify({ ok: false, errors: [`stdin is not JSON: ${e instanceof Error ? e.message : String(e)}`] }));
  process.exit(1);
}

const base = openBase(readFileSync(join(ROOT, 'specs/map/world.yaml'), 'utf8'));
const savedPath = join(ROOT, EDITS_FILE);
const saved = existsSync(savedPath) ? parseEdits(readFileSync(savedPath, 'utf8')) : [];
const working = existsSync(WORKING) ? parseEdits(readFileSync(WORKING, 'utf8')) : saved;
const state: State = { base, saved, working };

const out = handle(state, req);
if (out.working) atomicWrite(WORKING, serialiseEdits(out.working));
if (out.saved) atomicWrite(savedPath, serialiseEdits(out.saved));
if (out.image) {
  const p = req.out ?? '.cache/studio/preview.png';
  const file = isAbsolute(p) ? p : join(ROOT, p);
  atomicWrite(file, '');
  writeFileSync(file, encodePng(out.image.width, out.image.height, out.image.rgb));
  out.response.data = { ...(out.response.data as object), png: file };
}
// exitCode, not process.exit(): exit() truncates piped stdout at the 64 KiB pipe buffer (describe is larger).
process.stdout.write(`${JSON.stringify(out.response, null, 2)}\n`);
process.exitCode = out.response.ok ? 0 : 1;
