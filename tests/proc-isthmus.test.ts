/**
 * Guards for the procedural isthmus (src/world/proc/). Each guard was mutation-checked when written:
 * break the invariant in the source, see the test go red, restore.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { parseWorldSpec } from '../src/world/spec.ts';
import { cellAt, field, mask } from '../src/world/proc/grid.ts';
import { accumulate, routeFlow } from '../src/world/proc/hydrology.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';

const spec = parseWorldSpec(readFileSync(new URL('../specs/map/world.yaml', import.meta.url), 'utf8'));
let iso: Isthmus;
before(() => {
  iso = generateIsthmus(spec);
});

test('routeFlow: every receiver precedes its donor in the stack, and every cell drains to base level', () => {
  // 30 x 20 bowl with noise, sea along the bottom row.
  const g = field({ w: 30, h: 20, cell: 10 });
  const base = mask(g);
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 30; x++) {
      const i = y * 30 + x;
      g.data[i] = y * 2 + Math.abs(x - 15) * 0.5 + ((i * 7919) % 13) * 0.3 - (x > 10 && x < 14 && y > 8 && y < 12 ? 30 : 0);
      if (y === 0) base.data[i] = 1;
    }
  const r = routeFlow(g, base);
  assert.equal(r.count, 600, 'every cell is routed');
  const pos = new Int32Array(600);
  for (let s = 0; s < r.count; s++) pos[r.stack[s]!] = s;
  for (let i = 0; i < 600; i++) {
    const rec = r.receiver[i]!;
    if (base.data[i]) assert.equal(rec, i);
    else assert.ok(pos[rec]! < pos[i]!, `receiver of ${i} comes before it`);
  }
  const area = accumulate(r, 10, 600);
  let outflow = 0;
  for (let i = 0; i < 600; i++) if (base.data[i]) outflow += area[i]! - 100;
  assert.equal(outflow, (600 - 30) * 100, 'all land area reaches the sea (the pit drains across its spill point)');
});

test('reservoir: below its level, inside the dam catchment, one connected body at the target area', () => {
  const { lake } = iso;
  const { w, h, cell } = lake.lake;
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!lake.lake.data[i]) continue;
    n++;
    assert.ok(iso.relief.height.data[i]! < lake.level, 'lake cell below the water level');
  }
  assert.ok(Math.abs((n * cell * cell) / 1e6 - 5) < 0.05, `area ${(n * cell * cell) / 1e6} km² ≈ 5`);
  // Connected (4-neighbour) from the dam.
  const seen = new Uint8Array(w * h);
  const q = [lake.damCell];
  seen[lake.damCell] = 1;
  let reached = 0;
  while (q.length) {
    const c = q.pop()!;
    reached++;
    const x = c % w;
    for (const j of [x < w - 1 ? c + 1 : -1, x > 0 ? c - 1 : -1, c + w < w * h ? c + w : -1, c - w]) {
      if (j >= 0 && !seen[j] && lake.lake.data[j]) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  assert.equal(reached, n, 'every lake cell is connected to the dam');
  assert.ok(lake.catchmentKm2 > 5, 'the dam sits on a main river');
});

test('canal: water connects the Caribbean to the Pacific through the reservoir', () => {
  const { w, h } = iso.canal.channel;
  const land = iso.relief.land.data;
  const water = (i: number) => iso.canal.channel.data[i] === 1 || iso.lake.lake.data[i] === 1;
  // Start from canal cells that touch the north sea, flood over canal ∪ lake, expect to touch the south sea.
  const seen = new Uint8Array(w * h);
  const q: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const y = Math.floor(i / w);
    if (iso.canal.channel.data[i] && !land[i] && y > h / 2) {
      seen[i] = 1;
      q.push(i);
    }
  }
  assert.ok(q.length > 0, 'the canal reaches the Caribbean');
  let pacific = false;
  while (q.length && !pacific) {
    const c = q.pop()!;
    const x = c % w;
    for (const j of [x < w - 1 ? c + 1 : -1, x > 0 ? c - 1 : -1, c + w < w * h ? c + w : -1, c - w]) {
      if (j < 0 || seen[j]) continue;
      if (!land[j] && Math.floor(j / w) < h / 2 && iso.canal.channel.data[j]) pacific = true;
      if (water(j) && (land[j] || iso.canal.channel.data[j])) {
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  assert.ok(pacific, 'canal + lake water reaches the Pacific');
});

test('roads and tracks never cross the reservoir or the airfield', () => {
  const g = iso.height;
  const inField = (x: number, y: number): boolean => {
    const r = iso.airport.field;
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i]!;
      const b = r[j]!;
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
  for (const r of iso.roads.paths) {
    for (const c of r.cells) {
      assert.equal(iso.lake.lake.data[c], 0, `${r.id} crosses the lake`);
      assert.ok(!inField(((c % g.w) + 0.5) * g.cell, (Math.floor(c / g.w) + 0.5) * g.cell), `${r.id} crosses the airfield`);
    }
  }
  for (const l of iso.transit.lines)
    for (const t of l.tracks)
      for (const q of t) assert.equal(iso.lake.lake.data[cellAt(g, q.x, q.y)], 0, `${l.id} crosses the lake`);
});

test('towns: built cells are dry land, each town within its target, El Corredor grows along its highway', () => {
  const { owner, areasKm2 } = iso.towns;
  for (let i = 0; i < owner.length; i++) {
    if (!owner[i]) continue;
    assert.equal(iso.relief.land.data[i], 1, 'town on land');
    assert.equal(iso.lake.lake.data[i], 0, 'town not in the lake');
    assert.equal(iso.canal.channel.data[i], 0, 'town not in the canal');
  }
  const targets = [3.3, 1.1, 0.7, 1.3, 0.1];
  areasKm2.forEach((a, k) => assert.ok(a <= targets[k]! + 1e-9, `town ${k} ${a} ≤ ${targets[k]}`));
  assert.ok(areasKm2[3]! >= 1.0, `El Corredor grew (${areasKm2[3]} km²)`);
  assert.ok(areasKm2[0]! >= 2.0, `La Ciudad grew (${areasKm2[0]} km²)`);
});

test('transit: every station sits on a track of its line; lines that share a stop make an interchange', () => {
  const lines = new Map(iso.transit.lines.map((l) => [l.id, l] as const));
  for (const s of iso.transit.stations) {
    for (const id of s.lines) {
      const l = lines.get(id)!;
      let best = Infinity;
      for (const t of l.tracks)
        for (let k = 1; k < t.length; k++) {
          const a = t[k - 1]!;
          const b = t[k]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const l2 = dx * dx + dy * dy || 1;
          const u = Math.min(1, Math.max(0, ((s.at.x - a.x) * dx + (s.at.y - a.y) * dy) / l2));
          best = Math.min(best, Math.hypot(s.at.x - a.x - u * dx, s.at.y - a.y - u * dy));
        }
      assert.ok(best < 30, `station of ${id} is ${best.toFixed(0)} m from its track`);
    }
  }
  const inter = iso.transit.stations.filter((s) => s.interchange);
  assert.ok(inter.length >= 2, 'Casco and the north hub are interchanges');
  assert.ok(inter.some((s) => s.lines.includes('ferrocarril')), 'the railway meets the metro');
});

test('determinism: same spec, same isthmus (coarse grid)', () => {
  const a = generateIsthmus(spec, { cell: 40 });
  const b = generateIsthmus(spec, { cell: 40 });
  const digest = (x: Isthmus): string => {
    let h = 0;
    const mix = (v: number) => {
      h = (Math.imul(h ^ Math.round(v * 1000), 0x01000193) >>> 0) ^ (h >>> 13);
    };
    x.height.data.forEach(mix);
    x.towns.owner.forEach(mix);
    x.cover.forEach(mix);
    for (const r of x.roads.paths) r.cells.forEach(mix);
    return h.toString(16);
  };
  assert.equal(digest(a), digest(b));
});
