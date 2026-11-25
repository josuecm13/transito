#!/usr/bin/env node
/**
 * Map Studio benchmark (#13): wall time and memory of each protocol request, cold and with the evaluation memo warm.
 *   node --max-old-space-size=1536 tools/bench-studio.ts
 * Numbers depend on the machine; docs/map-reshape/map-studio-protocol.md records one run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, openBase, type Request, type State } from '../src/studio/protocol.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = openBase(readFileSync(join(ROOT, 'specs/map/world.yaml'), 'utf8'));
const state = (): State => ({ base, saved: [], working: [] });
const mb = (): number => Math.round(process.memoryUsage().rss / 1e6);
const rows: string[] = [];
let peak = 0;
function time(label: string, req: Request, s: State = state()): State {
  const t = performance.now();
  const o = handle(s, req);
  const ms = Math.round(performance.now() - t);
  peak = Math.max(peak, mb());
  rows.push(`${label.padEnd(46)} ${String(ms).padStart(6)} ms   rss ${String(mb()).padStart(4)} MB   ${o.response.ok ? 'ok' : 'refused'}`);
  return { ...s, working: o.working ?? s.working };
}
const TOWN = { path: 'procedural.towns.items[id=la-ciudad].target_km2', value: 1.9 };
const TOWERS: Request = { op: 'add-district', preset: 'paitilla-pacifica-towers', at: [3300, 1000] };

time('describe', { op: 'describe' });
time('inspect (no generation)', { op: 'inspect' });
time('preview 40 m, cold', { op: 'preview', cell: 40, metresPerPixel: 15 });
time('preview 40 m, memo warm', { op: 'preview', cell: 40, metresPerPixel: 15 });
let s = time('patch la-ciudad 1.9 @40 m (cold: 1 new generation)', { op: 'patch', cell: 40, changes: [TOWN] });
time('preview 40 m after that patch (memo warm)', { op: 'preview', cell: 40, metresPerPixel: 15 }, s);
s = time('add-district towers @40 m', { ...TOWERS, cell: 40 }, s);
time('preview 20 m of the edited map', { op: 'preview', cell: 20, metresPerPixel: 10 }, s);
time('validate 20 m (memo warm)', { op: 'validate', cell: 20 }, s);
time('save (validates at 20 m, memo warm)', { op: 'save' }, s);
time('save, cold (fresh edit)', { op: 'save' }, { ...state(), working: [{ path: 'procedural.towns.items[id=colon].target_km2', value: 0.55 }] });
time('diff against base @40 m', { op: 'diff', against: 'base', cell: 40 }, s);
console.log(rows.join('\n'));
console.log(`peak rss ${peak} MB (node ${process.version}, ${process.platform}/${process.arch})`);
