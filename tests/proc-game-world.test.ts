// The procedural isthmus in the shapes the game consumes (#12 2.5, card F1; src/world/proc/game-world.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { parseWorldSpec } from '../src/world/spec.ts';
import { cellAt, sample } from '../src/world/proc/grid.ts';
import { generateIsthmus, type Isthmus } from '../src/world/proc/isthmus.ts';
import { ProcTerrain, coverFromIsthmus, maskPolygons, waterFromIsthmus } from '../src/world/proc/game-world.ts';
import { coverAt } from '../src/world/cover.ts';

const spec = parseWorldSpec(readFileSync(new URL('../specs/map/world.yaml', import.meta.url), 'utf8'));
let iso: Isthmus;
let terrain: ProcTerrain;
const rect = { minX: 3900, maxX: 5300, minY: 900, maxY: 2800 };
before(() => {
  iso = generateIsthmus(spec);
  terrain = new ProcTerrain(iso.height, rect, { cell: spec.relief.grid.cell, margin: spec.relief.grid.margin, farCell: spec.relief.grid.far.cell, bounds: spec.bounds });
});

const area = (r: readonly { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]!.x - r[i]!.x) * (r[j]!.y + r[i]!.y);
  return a / 2;
};

test('ground: heightAt follows the generated height, inside the active rect and on the whole map', () => {
  const errs: number[] = [];
  for (let k = 0; k < 400; k++) {
    const x = 200 + ((k * 7919) % 5600);
    const y = 200 + ((k * 104729) % 7600);
    errs.push(Math.abs(terrain.heightAt(x, y) - sample(iso.height, x, y)));
  }
  for (let k = 0; k < 400; k++) {
    const x = rect.minX + ((k * 37) % 1400);
    const y = rect.minY + ((k * 53) % 1900);
    errs.push(Math.abs(terrain.heightAt(x, y) - sample(iso.height, x, y)));
  }
  errs.sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length / 2)]! < 0.5, `median error ${errs[Math.floor(errs.length / 2)]} m`);
  assert.ok(errs[errs.length - 1]! < 8, `max error ${errs[errs.length - 1]} m`);
  // The fine grid covers the rect at relief.grid.cell.
  const g = terrain.grid;
  assert.equal(g.cell, spec.relief.grid.cell);
  assert.ok(g.x0 <= rect.minX && g.y0 <= rect.minY && g.x0 + (g.cols - 1) * g.cell >= rect.maxX && g.y0 + (g.rows - 1) * g.cell >= rect.maxY);
});

test('ground: no step where the fine grid hands over to the far grid', () => {
  const g = terrain.grid;
  const xe = g.x0 + (g.cols - 1) * g.cell;
  for (let y = g.y0 + 50; y < g.y0 + (g.rows - 1) * g.cell; y += 97) {
    const step = Math.abs(terrain.heightAt(xe - 0.01, y) - terrain.heightAt(xe + 0.01, y));
    assert.ok(step < 3, `step ${step.toFixed(2)} m at x ${xe}, y ${y}`);
  }
});

test('ground: heightfield, normals and footprint bases agree with heightAt', () => {
  const hf = terrain.heightfield();
  const g = terrain.grid;
  assert.equal(hf.heights.length, g.rows * g.cols);
  assert.equal(hf.heights[0], g.data[(g.rows - 1) * g.cols]); // column 0, row 0 = the north-west node
  const n = terrain.normalAt(4300, 1300);
  assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9 && n.z > 0);
  const b = { center: { x: 4300, y: 1300 }, width: 9, depth: 12, angle: 0.3 };
  assert.ok(terrain.footprintBase(b) <= terrain.heightAt(4300, 1300) + 1e-9);
});

test('pure: maskPolygons outlines a region with a hole, areas exact', () => {
  const g = { w: 6, h: 5, cell: 10 };
  const on = (c: number): boolean => {
    const i = c % 6;
    const j = Math.floor(c / 6);
    return i >= 1 && i <= 4 && j >= 1 && j <= 3 && !(i === 2 && j === 2);
  };
  const polys = maskPolygons(g, on);
  assert.equal(polys.length, 1);
  assert.equal(polys[0]!.holes.length, 1);
  assert.equal(area(polys[0]!.ring), 12 * 100);
  assert.equal(area(polys[0]!.holes[0]!), -100);
});

test('water: the lake surface covers the lake at its level, rivers fall towards their mouth', () => {
  const w = waterFromIsthmus(iso, (x, y) => terrain.heightAt(x, y));
  assert.ok(w.water.length >= 1 && w.water.every((p) => p.kind === 'lake' && p.level === iso.lake.level));
  const net = w.water.reduce((s, p) => s + area(p.ring) + p.holes.reduce((t, h) => t + area(h), 0), 0) / 1e6;
  assert.ok(net >= iso.lake.areaKm2 && net < iso.lake.areaKm2 * 1.5, `water ${net.toFixed(2)} km² vs lake ${iso.lake.areaKm2.toFixed(2)} km²`);
  // Every lake cell centre is under the water surface.
  const L = iso.lake.lake;
  for (let c = 0; c < L.data.length; c += 17) {
    if (!L.data[c]) continue;
    const q = { x: ((c % L.w) + 0.5) * L.cell, y: (Math.floor(c / L.w) + 0.5) * L.cell };
    assert.ok(w.water.some((p) => inside(q, p.ring) && !p.holes.some((h) => inside(q, h))), `lake cell (${q.x}, ${q.y}) dry`);
  }
  assert.equal(w.rivers.length, iso.rivers.length);
  for (const r of w.rivers) {
    for (let i = 1; i < r.surface.length; i++) assert.ok(r.surface[i]! <= r.surface[i - 1]! && r.surface[i]! >= 0, `${r.id} rises at ${i}`);
  }
});

function inside(q: { x: number; y: number }, ring: readonly { x: number; y: number }[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

test('cover: towns are urban, sea and lake are water, the rest keeps the generated cover', () => {
  const cover = coverFromIsthmus(iso);
  assert.equal(coverAt(cover, iso.act1.anchor.x, iso.act1.anchor.y), 'urban_prior');
  assert.equal(coverAt(cover, 3000, 50), 'water'); // the Pacific off the city
  const L = iso.lake.lake;
  const c = L.data.indexOf(1);
  assert.equal(coverAt(cover, ((c % L.w) + 0.5) * L.cell, (Math.floor(c / L.w) + 0.5) * L.cell), 'water');
  const counts = new Map<string, number>();
  for (const k of cover.cover) counts.set(cover.classes[k]!, (counts.get(cover.classes[k]!) ?? 0) + 1);
  assert.ok((counts.get('forest') ?? 0) > cover.cover.length * 0.3, `forest ${counts.get('forest')}`);
  assert.ok((counts.get('clearing') ?? 0) > 0 && (counts.get('mangrove') ?? 0) > 0);
  assert.equal(cellAt(iso.towns.density, 0, 0), 0);
});
