import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWorldData } from '../src/world/world-data.ts';
import type { WorldData } from '../src/world/world-data.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');

/** Issue #7 "Rendimiento": the active area (2×4 km) generates in under 1.5 s in Node. */
const BUDGET_MS = 1500;

const runs: { ms: number; data: WorldData }[] = [];
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  const data = buildWorldData(yaml);
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

test('buildWorldData: same yaml → deep-equal data (functions aside)', () => {
  // slice.isPlayableLand is a closure (one per call), so compare everything else.
  const strip = (d: WorldData) => ({ ...d, slice: { ...d.slice, isPlayableLand: undefined } });
  assert.deepEqual(strip(runs[1]!.data), strip(first));
  assert.deepEqual(strip(runs[2]!.data), strip(first));
});

test('buildWorldData: buildings are the city buildings; every part is populated', () => {
  assert.equal(first.buildings, first.city.buildings);
  assert.ok(first.streets.graph.edges.length > 1000);
  assert.ok(first.streets.blocks.length > 100);
  assert.ok(first.city.buildings.length > 1000);
  assert.ok(first.walkGraph.edges.length > 1000);
  console.log(
    `world data: street edges=${first.streets.graph.edges.length} blocks=${first.streets.blocks.length} ` +
      `parcels=${first.city.parcels.length} buildings=${first.buildings.length} ` +
      `walk nodes=${first.walkGraph.nodes.length} walk edges=${first.walkGraph.edges.length}`,
  );
});
