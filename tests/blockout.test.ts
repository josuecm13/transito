import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import { sliceWorld } from '../src/world/slice.ts';
import { buildingCorners, generateBlockout } from '../src/world/blockout.ts';
import type { Building } from '../src/world/blockout.ts';
import { distanceToPolyline } from '../src/world/geometry.ts';
import { distance } from '../src/world/vec.ts';
import type { Vec2 } from '../src/world/vec.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const spec = parseWorldSpec(yaml);
const slice = sliceWorld(spec);
const t0 = performance.now();
const buildings = generateBlockout(spec, slice);
const elapsed = performance.now() - t0;

test('same seed gives identical output; another seed differs', () => {
  assert.deepEqual(generateBlockout(spec, slice), buildings);
  const other = { ...spec, blockout: { ...spec.blockout, seed: spec.blockout.seed + 1 } };
  assert.notDeepEqual(generateBlockout(other, slice), buildings);
});

test('building counts and generation time', () => {
  const counts: Record<string, number> = {};
  for (const b of buildings) counts[b.district] = (counts[b.district] ?? 0) + 1;
  console.log('blockout counts', JSON.stringify(counts), 'total', buildings.length);
  console.log(`blockout generation ${elapsed.toFixed(1)} ms`);
  assert.ok((counts['tito-corridor'] ?? 0) > 500, `tito-corridor ${counts['tito-corridor']}`);
  assert.ok(elapsed < 1500, `took ${elapsed} ms`);
});

test('every building corner is playable land', () => {
  for (const b of buildings) {
    for (const c of buildingCorners(b)) assert.ok(slice.isPlayableLand(c), `${b.district} ${c.x},${c.y}`);
  }
});

test('no corner within width/2 + sidewalk of any street centerline', () => {
  assert.ok(slice.streets.length > 0);
  for (const b of buildings) {
    for (const c of buildingCorners(b)) {
      for (const s of slice.streets) {
        const d = distanceToPolyline(c, s.centerline);
        assert.ok(d >= s.width / 2 + s.sidewalk, `${s.routeId} d=${d} at ${c.x},${c.y}`);
      }
    }
  }
});

test('no building center within landmarkClearance of act 1 landmarks', () => {
  for (const id of ['tito-home', 'corridor-market', 'miguelito-hills']) {
    const lm = slice.landmarks.find((l) => l.id === id)!;
    for (const b of buildings) assert.ok(distance(b.center, lm.position) >= spec.blockout.landmarkClearance, id);
  }
});

/** Separating-axis test for two convex quads; touching counts as no overlap. */
function overlaps(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 2; i++) {
      const p = poly[i]!;
      const q = poly[i + 1]!;
      const ax = -(q.y - p.y);
      const ay = q.x - p.x;
      const proj = (pts: Vec2[]): [number, number] => {
        const v = pts.map((c) => c.x * ax + c.y * ay);
        return [Math.min(...v), Math.max(...v)];
      };
      const [a0, a1] = proj(a);
      const [b0, b1] = proj(b);
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

test('no two buildings overlap (spatial hash + SAT)', () => {
  const cell = 50;
  const grid = new Map<string, number[]>();
  const quads: Vec2[][] = buildings.map((b: Building) => buildingCorners(b));
  const keysOf = (q: Vec2[]): string[] => {
    const xs = q.map((p) => p.x);
    const ys = q.map((p) => p.y);
    const keys: string[] = [];
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++) {
      for (let y = Math.floor(Math.min(...ys) / cell); y <= Math.floor(Math.max(...ys) / cell); y++) keys.push(`${x},${y}`);
    }
    return keys;
  };
  let checked = 0;
  quads.forEach((q, i) => {
    const seen = new Set<number>();
    for (const k of keysOf(q)) {
      for (const j of grid.get(k) ?? []) {
        if (seen.has(j)) continue;
        seen.add(j);
        checked++;
        assert.ok(!overlaps(q, quads[j]!), `buildings ${i} and ${j} overlap`);
      }
      const list = grid.get(k) ?? [];
      list.push(i);
      grid.set(k, list);
    }
  });
  assert.ok(checked > 0);
});
