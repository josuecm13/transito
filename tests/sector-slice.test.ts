// Card 7 of docs/map-reshape/03-technical/12-sectors-and-streaming.md: the pure per-sector slice of the baked isthmus.
// Guards: the 7 slices own every cell exactly once (120,000), their owned bytes sum to the whole, re-assembling is
// byte-exact, and the corredor slice holds the Act 1 rect (saved Studio edits) while buildWorldData keeps its counts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWorldWithEdits } from '../src/studio/saved.ts';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import { gameSpecFromIsthmus } from '../src/world/proc/game-spec.ts';
import { parseSectors, sectorOf } from '../src/world/sectors.ts';
import { assembleArrays, assembleIsthmus, cellArrays, sliceBytes, sliceIsthmus } from '../src/world/sector-slice.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { parseWorldSpec } from '../src/world/spec.ts';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const worldYaml = read('specs/map/world.yaml');
const table = parseSectors(read('specs/map/sectors.yaml'), parseWorldSpec(worldYaml));
const authored = parseWorldWithEdits(worldYaml, read('specs/map/procedural-edits.json'));
const iso = generateIsthmus(authored);
const slices = table.sectors.map((s) => sliceIsthmus(iso, table, s.id));
const whole = cellArrays(iso);
const wholeBytes = Object.values(whole).reduce((n, a) => n + a.byteLength, 0);
const same = (a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }, b: typeof a): boolean =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

test('(d) byte table per sector', () => {
  const rows = slices.map((s) => {
    const b = sliceBytes(s);
    const w = s.area;
    return { sector: s.id, window: `${w.gx1 - w.gx0}x${w.gy1 - w.gy0}`, ownedCells: s.ownedCells, ownedKB: Math.round(b.owned / 1024), windowKB: Math.round(b.area / 1024) };
  });
  console.table(rows);
  console.log(`whole per-cell arrays: ${Object.keys(whole).length} arrays, ${Math.round(wholeBytes / 1024)} KB`);
  assert.equal(rows.length, 7);
});

test('(a) the 7 slices own every cell exactly once: 300 x 400 = 120,000 cells, owned bytes = whole bytes', () => {
  assert.equal(iso.height.w * iso.height.h, 120000);
  assert.equal(slices.reduce((n, s) => n + s.ownedCells, 0), 120000);
  const seen = new Uint8Array(120000);
  for (const s of slices) {
    const { gx0, gy0, gx1, gy1 } = s.area;
    for (let gy = gy0; gy < gy1; gy++)
      for (let gx = gx0; gx < gx1; gx++) if (s.owned[(gy - gy0) * (gx1 - gx0) + gx - gx0]) seen[gy * 300 + gx] = seen[gy * 300 + gx]! + 1;
    // every owned cell really belongs to this sector
    for (let gy = gy0; gy < gy1; gy++)
      for (let gx = gx0; gx < gx1; gx++)
        if (s.owned[(gy - gy0) * (gx1 - gx0) + gx - gx0]) assert.equal(sectorOf(table, gx * 20 + 10, gy * 20 + 10).id, s.id);
  }
  assert.ok(seen.every((v) => v === 1), 'a cell is owned zero or several times');
  const owned = slices.reduce((n, s) => n + sliceBytes(s).owned, 0);
  assert.equal(owned, wholeBytes, 'owned bytes must sum to the whole per-cell arrays');
  const window = slices.reduce((n, s) => n + sliceBytes(s).area, 0);
  assert.ok(window >= wholeBytes, 'windows (owned + apron + bounding-box overlap) cannot be smaller than the whole');
});

test('(b) re-assembling the slices reproduces every per-cell array byte for byte', () => {
  const back = assembleArrays(slices);
  assert.deepEqual(Object.keys(back), Object.keys(whole));
  for (const [path, a] of Object.entries(whole)) {
    assert.equal(back[path]!.constructor, a.constructor, path);
    assert.ok(same(back[path]!, a), `${path} differs after assembling`);
  }
  assert.ok(Object.keys(whole).includes('height.data') && Object.keys(whole).includes('cover') && Object.keys(whole).length >= 17);
});

test('(b2) apron: every window cell outside the owned set equals the whole grid at that cell', () => {
  for (const s of slices) {
    const { gx0, gy0, gx1, gy1 } = s.area;
    const ww = gx1 - gx0;
    const h = s.arrays['height.data']!;
    for (let gy = gy0; gy < gy1; gy++) for (let gx = gx0; gx < gx1; gx++) assert.equal(h[(gy - gy0) * ww + gx - gx0], whole['height.data']![gy * 300 + gx], `${s.id} (${gx},${gy})`);
  }
});

test('(c) the corredor slice holds the Act 1 rect (saved edits) and buildWorldData keeps its counts', () => {
  const game = gameSpecFromIsthmus(authored, iso);
  const { x, y } = game.spec.activeArea;
  console.log(`Act 1 rect x ${x[0]}-${x[1]} y ${y[0]}-${y[1]}`);
  assert.deepEqual([x[0], x[1], y[0], y[1]], [3588, 5450, 562, 3610], 'Act 1 rect moved: update this guard on purpose');
  const s = slices.find((c) => c.id === 'corredor')!;
  const { gx0, gy0, gx1, gy1 } = s.area;
  let cells = 0;
  for (let gy = Math.floor(y[0] / 20); gy < Math.ceil(y[1] / 20); gy++)
    for (let gx = Math.floor(x[0] / 20); gx < Math.ceil(x[1] / 20); gx++) {
      cells++;
      assert.ok(gx >= gx0 && gx < gx1 && gy >= gy0 && gy < gy1, `rect cell (${gx},${gy}) outside the corredor window`);
      assert.equal(s.owned[(gy - gy0) * (gx1 - gx0) + gx - gx0], 1, `rect cell (${gx},${gy}) not owned by corredor`);
      assert.equal(s.arrays['height.data']![(gy - gy0) * (gx1 - gx0) + gx - gx0], iso.height.data[gy * 300 + gx]);
    }
  assert.equal(cells, 94 * 153, 'rect covers 94 x 153 cells of 20 m');
  assert.ok(s.vectors.airport !== null && s.vectors.act1Strip !== null);
  assert.ok(s.vectors.landmarks.length > 0 && s.vectors.transitStations.length > 0 && s.vectors.trails.length > 0);

  // buildWorldData with the full isthmus, and with the one reassembled from the slices: same counts as the game console.
  const a = buildWorldData(worldYaml, iso);
  const b = buildWorldData(worldYaml, assembleIsthmus(slices, iso));
  const counts = (d: typeof a): number[] => [d.streets.graph.edges.length, d.buildings.length];
  console.log(`buildWorldData (full isthmus, no saved edits in this call): street edges ${counts(a)[0]}, buildings ${counts(a)[1]}; reassembled: ${counts(b)}`);
  assert.deepEqual(
    counts(a),
    [790, 1860],
    'game console baseline, re-baselined 2026-11-26 (card 3c, deterministic dmath in the section generator, new /tmp/transito-scout/final.png): 790 street edges, 1860 buildings, 117 blocks (was 735 / 1763 / 104 on platform Math.*, and 645 / 1253 / 71 with the informal grower before card 3b)',
  );
  assert.deepEqual(counts(b), counts(a));
});
