import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDifferentData, assertSameData, determinismTest } from './determinism.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorldData } from '../src/world/world-data.ts';
import { parseWorldSpec } from '../src/world/spec.ts';
import { generateIsthmus } from '../src/world/proc/isthmus.ts';
import type { WorldData } from '../src/world/world-data.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');

/**
 * Issue #7 "Rendimiento": the active area generates in under 1.5 s in Node. Since #12 2.5 the active area is
 * the Act 1 strip of the procedural map; the isthmus itself is generated once (~6 s, measured separately,
 * to be baked: card F6) and passed in, so the budget keeps measuring the active area.
 */
const BUDGET_MS = 1500;

const iso = generateIsthmus(parseWorldSpec(yaml));
const runs: { ms: number; data: WorldData }[] = [];
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  const data = buildWorldData(yaml, iso);
  runs.push({ ms: performance.now() - t0, data });
}
const first = runs[0]!.data;

test('buildWorldData: median of 3 runs under budget (first run is cold)', () => {
  const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
  const median = sorted[1]!;
  console.log(
    `buildWorldData cold=${runs[0]!.ms.toFixed(0)} ms warm=${runs[1]!.ms.toFixed(0)}/${runs[2]!.ms.toFixed(0)} ms median=${median.toFixed(0)} ms`,
  );
  assert.ok(median < BUDGET_MS, `median ${median.toFixed(0)} ms >= ${BUDGET_MS} ms`);
});

determinismTest('buildWorldData: same yaml → identical data (functions aside)', () => {
  // slice.isPlayableLand is a closure (one per call), so compare everything else.
  const strip = (d: WorldData) => ({ ...d, slice: { ...d.slice, isPlayableLand: undefined } });
  assertSameData(strip(runs[1]!.data), strip(first), 'buildWorldData run 2 vs run 1');
  assertSameData(strip(runs[2]!.data), strip(first), 'buildWorldData run 3 vs run 1');
});

test('buildWorldData: buildings are the city buildings; every part is populated', () => {
  assert.equal(first.buildings, first.city.buildings);
  // The Act 1 strip (#12 2.5): El Corredor's ~0.5 km² of the procedural map, not the authored 2×4 km rect.
  assert.ok(first.streets.graph.edges.length > 400);
  assert.ok(first.streets.blocks.length > 40);
  assert.ok(first.city.buildings.length > 1000);
  assert.ok(first.walkGraph.edges.length > 600);
  assert.equal(first.isthmus, iso);
  assert.ok(first.cover.cover.length > 0 && first.water.rivers.length > 0);
  console.log(
    `world data: street edges=${first.streets.graph.edges.length} blocks=${first.streets.blocks.length} ` +
      `parcels=${first.city.parcels.length} buildings=${first.buildings.length} ` +
      `walk nodes=${first.walkGraph.nodes.length} walk edges=${first.walkGraph.edges.length}`,
  );
});

test('isCityBlock: only blocks of built districts are city ground; wild faces closed by the frame keep the land cover', async () => {
  const { isCityBlock } = await import('../src/world/streets/city.ts');
  const spec = first.spec;
  const stub = { ...spec, blockout: { ...spec.blockout, districts: { built: spec.blockout.districts['tito-corridor']! } } };
  assert.equal(isCityBlock(stub, { district: 'built' }), true);
  assert.equal(isCityBlock(stub, { district: 'wild' }), false);
  assert.equal(isCityBlock(stub, { district: undefined }), false);

  const area = (r: { x: number; y: number }[]): number => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!;
      const q = r[(i + 1) % r.length]!;
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  };
  const blocks = first.streets.blocks;
  const withBuildings = new Set(first.buildings.map((b) => b.block));
  for (const b of blocks) {
    if (withBuildings.has(b.id)) assert.ok(isCityBlock(spec, b), `block ${b.id} has buildings but is not city ground`);
  }
  // The Act 1 strip: the largest face is the wild land between the frame and the highway, not a block.
  const largest = [...blocks].sort((a, b) => area(b.ring) - area(a.ring))[0]!;
  assert.equal(isCityBlock(spec, largest), false, `largest face (${(area(largest.ring) / 1e4).toFixed(0)} ha, ${largest.district})`);
  // City ground is the barrio and the airport, a small part of the rect (0.154 when written; 1.14 if every face counted).
  const r = first.slice.rect;
  const city = blocks.filter((b) => isCityBlock(spec, b)).reduce((s, b) => s + area(b.ring), 0);
  const share = city / ((r.maxX - r.minX) * (r.maxY - r.minY));
  assert.ok(share > 0.02 && share < 0.3, `city ground share ${share.toFixed(3)}`);
});
