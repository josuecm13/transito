// Sector table (card 5 of docs/map-reshape/03-technical/12-sectors-and-streaming.md): data + pure functions.
// Guards: the 7 sectors tile the 6000 x 8000 m box, match the doc's areas, contain the Act 1 rect (with the saved
// Studio edits) and form a symmetric, connected graph whose neighbours are the real borders.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWorldSpec } from '../src/world/spec.ts';
import { adjacency, parseSectors, SectorSpecError, sectorAreas, sectorOf } from '../src/world/sectors.ts';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const sectorsYaml = read('specs/map/sectors.yaml');
const worldYaml = read('specs/map/world.yaml');
const table = parseSectors(sectorsYaml, parseWorldSpec(worldYaml));

// Doc 1.2 "Box km2" column.
const DOC_KM2: Record<string, number> = {
  limon: 4.95,
  lago: 10.77,
  corte: 2.15,
  ribera: 3.09,
  ciudad: 3.87,
  corredor: 12.21,
  cordillera: 10.96,
};
const CELL = 20;
const NX = 300;
const NY = 400;

test('the table has the 7 sectors of the doc; only corredor is full tier', () => {
  assert.deepEqual(table.sectors.map((s) => s.id).sort(), Object.keys(DOC_KM2).sort());
  assert.deepEqual(table.extent, { width: 6000, height: 8000 });
  for (const s of table.sectors) assert.equal(s.tier === 'full', s.id === 'corredor', s.id);
});

test('(a) every 20 m cell of the box maps to exactly one sector and the areas sum to 48.00 km2', () => {
  const claims = (s: (typeof table.sectors)[number], x: number, y: number): boolean => {
    const inBox = s.boxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
    if (!inBox || !s.side) return inBox;
    const line = table.canalBorder;
    let bx = line[line.length - 1]![0];
    if (y <= line[0]![1]) bx = line[0]![0];
    else
      for (let i = 1; i < line.length; i++)
        if (y <= line[i]![1]) {
          const [ax, ay] = line[i - 1]!;
          const [cx, cy] = line[i]!;
          bx = ax + ((cx - ax) * (y - ay)) / (cy - ay);
          break;
        }
    return s.side === 'west' ? x < bx : x >= bx;
  };
  let cells = 0;
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const x = (i + 0.5) * CELL;
      const y = (j + 0.5) * CELL;
      let n = 0;
      for (const s of table.sectors) if (claims(s, x, y)) n++;
      assert.equal(n, 1, `cell (${i}, ${j}) at (${x}, ${y}) is claimed by ${n} sectors`);
      cells++;
    }
  assert.equal(cells, 120_000);
  const areas = sectorAreas(table, CELL);
  const total = [...areas.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 48) <= 0.001, `total ${total} km2`);
});

test('sectorOf is total: points outside the box clamp to the nearest sector', () => {
  assert.equal(sectorOf(table, -500, -500).id, 'ribera');
  assert.equal(sectorOf(table, 9000, -10).id, 'corredor');
  assert.equal(sectorOf(table, 6000, 8000).id, 'cordillera');
  assert.equal(sectorOf(table, 100, 99999).id, 'limon');
  assert.equal(sectorOf(table, 4300, 1273).id, 'corredor');
  assert.equal(sectorOf(table, 1000, 1000).id, 'ribera');
  assert.equal(sectorOf(table, 1400, 1000).id, 'ciudad');
  assert.throws(() => sectorOf(table, Number.NaN, 0), RangeError);
});

test('(b) per-sector area equals the doc table within 2 %', () => {
  const areas = sectorAreas(table, CELL);
  for (const [id, doc] of Object.entries(DOC_KM2)) {
    const got = areas.get(id)!;
    assert.ok(Math.abs(got - doc) / doc <= 0.02, `${id}: ${got.toFixed(3)} km2 vs doc ${doc} km2`);
  }
});

test('(c) the Act 1 rect (with the saved Studio edits) lies fully inside corredor', async () => {
  const { parseWorldWithEdits } = await import('../src/studio/saved.ts');
  const { generateIsthmus } = await import('../src/world/proc/isthmus.ts');
  const { gameSpecFromIsthmus } = await import('../src/world/proc/game-spec.ts');
  const authored = parseWorldWithEdits(worldYaml, read('specs/map/procedural-edits.json'));
  const game = gameSpecFromIsthmus(authored, generateIsthmus(authored));
  const { x, y } = game.spec.activeArea;
  // doc 0.1: about x 3056-5465, y 824-3782
  assert.ok(x[0] > 2900 && x[1] < 6000 && y[0] >= 0 && y[1] < 3950, `rect x ${x} y ${y} is not the expected Act 1 rect`);
  const margin = authored.relief.grid.margin; // doc S2: the sector holds the rect plus the fine-grid margin
  for (const m of [0, margin])
    for (let px = x[0] - m; px <= x[1] + m; px += 20)
      for (let py = y[0] - m; py <= y[1] + m; py += 20) {
        const id = sectorOf(table, px, py).id;
        if (id !== 'corredor') assert.fail(`(${px}, ${py}) (rect margin ${m}) is in ${id}, not corredor`);
      }
});

test('(d) neighbours are symmetric, the graph is connected and neighbours are the real borders', () => {
  const adj = adjacency(table);
  for (const [a, ns] of adj) for (const b of ns) assert.ok(adj.get(b)!.includes(a), `${a} -> ${b} is not symmetric`);
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    adj.get(id)!.forEach(walk);
  };
  walk(table.sectors[0]!.id);
  assert.equal(seen.size, table.sectors.length, `reached ${[...seen]}`);
  // geometry says the same: two sectors are neighbours when 4-adjacent cells belong to them
  const real = new Map(table.sectors.map((s) => [s.id, new Set<string>()] as const));
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = sectorOf(table, (i + 0.5) * CELL, (j + 0.5) * CELL).id;
      for (const [di, dj] of [[1, 0], [0, 1]] as const) {
        if (i + di >= NX || j + dj >= NY) continue;
        const b = sectorOf(table, (i + di + 0.5) * CELL, (j + dj + 0.5) * CELL).id;
        if (a !== b) (real.get(a)!.add(b), real.get(b)!.add(a));
      }
    }
  for (const [id, ns] of adj) assert.deepEqual([...ns].sort(), [...real.get(id)!].sort(), `${id}: declared vs real neighbours`);
});

test('(e) the parser rejects a typo key, a duplicate id, an asymmetric neighbour and an unknown district', () => {
  const broken = (from: string, to: string, why: RegExp, world = parseWorldSpec(worldYaml)): void => {
    const text = sectorsYaml.replace(from, to);
    assert.notEqual(text, sectorsYaml, `mutation ${from} must change the yaml`);
    assert.throws(() => parseSectors(text, world), (e: unknown) => e instanceof SectorSpecError && why.test(e.message), from);
  };
  broken('    tier: blocks\n    boxes: [[0, 6500', '    tiers: blocks\n    boxes: [[0, 6500', /sectors\[0\]\.tiers: unknown key/);
  broken('id: corte', 'id: lago', /duplicate id "lago"/);
  broken('neighbours: [lago, cordillera]', 'neighbours: [lago]', /"limon" does not list "cordillera" back/);
  broken('districts: [colon]', 'districts: [colonn]', /unknown district "colonn"/);
  assert.doesNotThrow(() => parseSectors(sectorsYaml)); // no world passed: districts are not checked
});
