/**
 * Guards for the procedural isthmus (src/world/proc/). Each guard was mutation-checked when written:
 * break the invariant in the source, see the test go red, restore.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { distanceToPolyline, pointInPolygon } from '../src/world/geometry.ts';
import { parseWorldSpec } from '../src/world/spec.ts';
import { cellAt, field, mask } from '../src/world/proc/grid.ts';
import { accumulate, routeFlow } from '../src/world/proc/hydrology.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { growTowns } from '../src/world/proc/settlements.ts';

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
  const targets = spec.procedural.towns.items.map((t) => t.targetKm2);
  areasKm2.forEach((a, k) => assert.ok(a <= targets[k]! + 1e-9, `town ${k} ${a} ≤ ${targets[k]}`));
  assert.ok(areasKm2[3]! >= 0.8 * targets[3]!, `El Corredor grew (${areasKm2[3]} of ${targets[3]} km²)`);
  assert.ok(areasKm2[0]! >= 0.8 * targets[0]!, `La Ciudad grew (${areasKm2[0]} of ${targets[0]} km²)`);
});

/** Centres of the cells each town owns, by town index. */
const townCells = (): { x: number; y: number }[][] => {
  const { owner } = iso.towns;
  const { w, cell } = iso.towns.density;
  const out: { x: number; y: number }[][] = spec.procedural.towns.items.map(() => []);
  for (let i = 0; i < owner.length; i++) if (owner[i]) out[owner[i]! - 1]!.push({ x: ((i % w) + 0.5) * cell, y: (Math.floor(i / w) + 0.5) * cell });
  return out;
};

test('towns (real map): different towns are more than `separation` apart', () => {
  const sep = spec.procedural.towns.separation;
  assert.ok(sep > 0, 'test setup: the spec turns separation on');
  const cells = townCells();
  for (let a = 0; a < cells.length; a++)
    for (let b = a + 1; b < cells.length; b++) {
      let best = Number.POSITIVE_INFINITY;
      for (const p of cells[a]!) for (const q of cells[b]!) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
      assert.ok(best > sep, `towns ${a} and ${b} are ${best.toFixed(0)} m apart (separation ${sep} m)`);
    }
});

test('towns (real map): nothing is built within `airport_buffer` of the airfield', () => {
  const buffer = spec.procedural.towns.airportBuffer;
  assert.ok(buffer > 0, 'test setup: the spec turns the airport buffer on');
  const ring = [...iso.airport.field, iso.airport.field[0]!];
  let nearest = Number.POSITIVE_INFINITY;
  for (const town of townCells())
    for (const p of town) nearest = Math.min(nearest, pointInPolygon(p, iso.airport.field) ? 0 : distanceToPolyline(p, ring));
  // The buffer is measured on the grid (chamfer distance, within 8 %).
  assert.ok(nearest > buffer * 0.92, `closest town cell ${nearest.toFixed(0)} m from the airfield (buffer ${buffer} m)`);
});

test('towns (real map): El Corredor builds only within `reach` of its highway', () => {
  const item = spec.procedural.towns.items.find((t) => t.id === 'el-corredor')!;
  const reach = item.seedAlong?.reach;
  assert.ok(reach !== undefined, 'test setup: El Corredor has a reach');
  const k = spec.procedural.towns.items.indexOf(item);
  const { w, cell } = iso.towns.density;
  const road = iso.roads.paths.find((r) => r.id === item.seedAlong!.route)!.cells.map((c) => ({ x: ((c % w) + 0.5) * cell, y: (Math.floor(c / w) + 0.5) * cell }));
  let far = 0;
  for (const p of townCells()[k]!) far = Math.max(far, Math.min(...road.map((q) => Math.hypot(p.x - q.x, p.y - q.y))));
  // `reach` is measured on the grid (chamfer distance, within 8 %).
  assert.ok(far <= reach * 1.08 + cell, `farthest El Corredor cell ${far.toFixed(0)} m from its highway (reach ${reach} m)`);
});

test('towns: reported area is the final built cells (river cells crossed by growth are not counted)', () => {
  // Real map: every reported area equals its owned cells.
  const { owner, areasKm2 } = iso.towns;
  const { cell } = iso.towns.density;
  const counts = areasKm2.map(() => 0);
  for (let i = 0; i < owner.length; i++) if (owner[i]) counts[owner[i]! - 1]! += 1;
  areasKm2.forEach((a, k) => assert.ok(Math.abs(a - (counts[k]! * cell * cell) / 1e6) < 1e-9, `town ${k}: reported ${a}, built ${(counts[k]! * cell * cell) / 1e6}`));
  // Synthetic: flat 40 x 20 plain, a river column at x = 20, one town seeded west of it with room to cross.
  const g = { w: 40, h: 20, cell: 10 };
  const suit = field(g, 1);
  const river = mask(g);
  for (let y = 0; y < g.h; y++) river.data[y * g.w + 20] = 1;
  const t = growTowns(suit, [mask(g)], { towns: [{ id: 't', seeds: [{ x: 105, y: 105 }], targetKm2: 0.06 }], roadDiscount: 0.5, jitter: 0, jitterWavelength: 50, minSuitability: 0.1, seedSnap: 0, seed: 1 }, river);
  let built = 0;
  let east = 0;
  for (let i = 0; i < g.w * g.h; i++) {
    if (!t.owner[i]) continue;
    assert.equal(river.data[i], 0, 'river cell left unbuilt');
    built++;
    if (i % g.w > 20) east++;
  }
  assert.ok(east > 0, 'test setup: growth crossed the river');
  assert.ok(built < 600, 'test setup: some of the 600-cell budget went to river cells');
  assert.equal(t.areasKm2[0], (built * 100) / 1e6);
});

test('towns: separation keeps unbuilt ground between different towns', () => {
  // Flat 60 x 20 plain, two towns seeded 200 m apart, each with more budget than fits between them.
  const g = { w: 60, h: 20, cell: 10 };
  const suit = field(g, 1);
  const towns = [
    { id: 'a', seeds: [{ x: 205, y: 105 }], targetKm2: 0.05 },
    { id: 'b', seeds: [{ x: 405, y: 105 }], targetKm2: 0.05 },
  ];
  const base = { roadDiscount: 0.5, jitter: 0, jitterWavelength: 50, minSuitability: 0.1, seedSnap: 0, seed: 1 };
  const minGap = (owner: Uint8Array): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < owner.length; i++)
      for (let j = 0; j < owner.length; j++)
        if (owner[i] && owner[j] && owner[i] !== owner[j]) best = Math.min(best, Math.hypot((i % g.w) - (j % g.w), Math.floor(i / g.w) - Math.floor(j / g.w)) * g.cell);
    return best;
  };
  const touching = growTowns(suit, [mask(g), mask(g)], { ...base, towns }).owner;
  assert.ok(minGap(touching) <= 15, `test setup: without separation the towns meet (${minGap(touching)} m)`);
  const t = growTowns(suit, [mask(g), mask(g)], { ...base, towns, separation: 60 });
  assert.ok(minGap(t.owner) > 60, `towns ${minGap(t.owner)} m apart, separation 60 m`);
  assert.ok(t.areasKm2[0]! > 0.02 && t.areasKm2[1]! > 0.02, `both towns still grew (${t.areasKm2.join(', ')} km²)`);
});

test('towns: patches leave unbuilt gaps that growth crosses but does not count', () => {
  const g = { w: 80, h: 80, cell: 10 };
  const suit = field(g, 1);
  const patches = { wavelength: 150, threshold: 0.45 };
  const base = { roadDiscount: 0.5, jitter: 0, jitterWavelength: 50, minSuitability: 0.1, seedSnap: 0, seed: 1 };
  const t = growTowns(suit, [mask(g)], { ...base, towns: [{ id: 'p', seeds: [{ x: 405, y: 405 }], targetKm2: 0.2, patches }] });
  const plain = growTowns(suit, [mask(g)], { ...base, towns: [{ id: 'p', seeds: [{ x: 405, y: 405 }], targetKm2: 0.2 }] });
  // A cell is a gap if the plain town built it and the patchy one, with budget to spare, did not.
  let built = 0;
  let gapsInside = 0;
  for (let i = 0; i < g.w * g.h; i++) {
    if (t.owner[i]) built++;
    else if (plain.owner[i]) gapsInside++;
  }
  assert.ok(gapsInside > 0, 'patchy town leaves gaps inside the plain footprint');
  assert.equal(t.areasKm2[0], (built * 100) / 1e6, 'reported area is the built cells');
  assert.ok(Math.abs(t.areasKm2[0]! - 0.2) < 0.001, `gaps do not use the budget: still reaches its target (${t.areasKm2[0]} km²)`);
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
