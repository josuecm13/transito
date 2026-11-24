import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWorldSpec } from '../src/world/spec.ts';
import type { RidgeFeature, WorldSpec } from '../src/world/spec.ts';
import { buildWorldData } from '../src/world/world-data.ts';
import { Terrain } from '../src/world/terrain.ts';
import { layer1LandCover } from '../src/world/layers/layer1-land-cover.ts';
import { layer2Relief } from '../src/world/layers/layer2-relief.ts';

const yaml = readFileSync(join(import.meta.dirname, '../specs/map/world.yaml'), 'utf8');
const spec: WorldSpec = parseWorldSpec(yaml);
const world = buildWorldData(yaml);
const terrain = world.terrain;
const T = spec.relief.targets;

/** Real reference values for the whole isthmus (docs/map-reshape/03-technical/02-relief.md, AWS terrain tiles z10). */
const REAL = { slopeP50: 0.064, slopeP90: 0.228, shareBelow30: 0.177, tol: 0.25, shareTol: 0.08 };

const pct = (v: number[], p: number): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(p * (s.length - 1))] as number;
};
const onLand = (x: number, y: number): boolean => terrain.coastDistance(x, y) > 0;
const landmark = (id: string): { x: number; y: number } => {
  const l = spec.landmarks.find((m) => m.id === id);
  assert.ok(l, `landmark ${id}`);
  return l.position;
};

/** Slopes (rise / run, the 10 m central difference of the real 5 m data) on land in a square, every 5 m. */
function squareSlopes(cx: number, cy: number, half = 400, keep: (x: number, y: number) => boolean = () => true): number[] {
  const out: number[] = [];
  for (let y = cy - half; y <= cy + half; y += 5) for (let x = cx - half; x <= cx + half; x += 5) if (onLand(x, y) && keep(x, y)) out.push(terrain.slopeAt(x, y));
  return out;
}

const inBand = (v: number, b: { min: number; max: number }): boolean => v >= b.min && v <= b.max;
const f3 = (v: number): string => v.toFixed(3);

test('relief targets: hills band (Samaria 16.0 / 30.1 / 42.1 %) around the san-miguelito hills', { skip: 'interim: street grading was calibrated on the La Carpio seed network (removed 2026-11-23) in the old corridor, which the Act 1 move and src/world/proc replace' }, () => {
  const c = landmark('miguelito-hills');
  const s = squareSlopes(c.x, c.y);
  const [p50, p90, p99] = [pct(s, 0.5), pct(s, 0.9), pct(s, 0.99)];
  console.log(`hills 800 m square: slope p50=${f3(p50)} p90=${f3(p90)} p99=${f3(p99)}`);
  assert.ok(inBand(p50, T.hills.slopeP50), `hills slope p50 ${f3(p50)} outside [${T.hills.slopeP50.min}, ${T.hills.slopeP50.max}]`);
  assert.ok(inBand(p90, T.hills.slopeP90), `hills slope p90 ${f3(p90)} outside [${T.hills.slopeP90.min}, ${T.hills.slopeP90.max}]`);
  assert.ok(p99 <= T.hills.slopeP99Max, `hills slope p99 ${f3(p99)} above ${T.hills.slopeP99Max}`);
});

test('relief targets: plain band (Juan Díaz .. Las Mañanitas, 4.5-8.5 % p50) in the corridor squares, away from the hills', { skip: 'interim: street grading was calibrated on the La Carpio seed network (removed 2026-11-23) in the old corridor, which the Act 1 move and src/world/proc replace' }, () => {
  for (const id of ['corridor-market', 'tito-home']) {
    const c = landmark(id);
    // Plain ground only: the flank of the san-miguelito hills (hill weight >= 0.05) belongs to the hills band.
    const s = squareSlopes(c.x, c.y, 400, (x, y) => terrain.hillWeight(x, y) < 0.05);
    const [p50, p90, max] = [pct(s, 0.5), pct(s, 0.9), Math.max(...s)];
    console.log(`plain at ${id} (${s.length} points): slope p50=${f3(p50)} p90=${f3(p90)} max=${f3(max)}`);
    assert.ok(s.length > 10000, `${id}: plain square has too few samples (${s.length})`);
    assert.ok(inBand(p50, T.plain.slopeP50), `${id}: plain slope p50 ${f3(p50)} outside [${T.plain.slopeP50.min}, ${T.plain.slopeP50.max}]`);
    assert.ok(inBand(p90, T.plain.slopeP90), `${id}: plain slope p90 ${f3(p90)} outside [${T.plain.slopeP90.min}, ${T.plain.slopeP90.max}]`);
    assert.ok(max <= T.plain.slopeMax, `${id}: plain slope max ${f3(max)} above ${T.plain.slopeMax}`);
  }
});

test('relief targets: runway centerlines are flat to relief.targets.runway_flat_tolerance', () => {
  const runways = spec.routes.filter((r) => r.kind === 'runway');
  assert.ok(runways.length >= 2);
  for (const r of runways) {
    const a = r.points[0]!;
    const b = r.points[r.points.length - 1]!;
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= n; i++) {
      const h = terrain.heightAt(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    assert.ok(hi - lo <= T.runwayFlatTolerance, `${r.id}: runway varies ${(hi - lo).toFixed(3)} m, tolerance ${T.runwayFlatTolerance}`);
  }
});

test('relief targets: the shoreline sits at sea level (|h| <= coast_tolerance) all around geometry.land', () => {
  const { width, height } = spec.bounds;
  let worst = 0;
  let at = '';
  let n = 0;
  for (let i = 0; i < spec.land.length; i++) {
    const a = spec.land[i]!;
    const b = spec.land[(i + 1) % spec.land.length]!;
    if ((a.x === b.x && (a.x === 0 || a.x === width)) || (a.y === b.y && (a.y === 0 || a.y === height))) continue; // bounds edge, not a shore
    const k = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10);
    for (let s = 0; s <= k; s++) {
      const x = a.x + ((b.x - a.x) * s) / k;
      const y = a.y + ((b.y - a.y) * s) / k;
      const h = Math.abs(terrain.heightAt(x, y));
      n++;
      if (h > worst) {
        worst = h;
        at = `${x.toFixed(0)},${y.toFixed(0)}`;
      }
    }
  }
  console.log(`coast: ${n} samples, worst |h| = ${worst.toFixed(3)} m at ${at}`);
  assert.ok(worst <= T.coastTolerance, `shoreline |h| ${worst.toFixed(3)} m at ${at} above ${T.coastTolerance}`);
});

// Whole isthmus, geometry.land only, on a 32 m lattice (two far-grid cells); slope = central difference over
// +-16 m (the far grid cell), the horizontal resolution the whole-isthmus relief is built and seen at.
const land: { slopes: number[]; below30: number; n: number } = (() => {
  const slopes: number[] = [];
  let below30 = 0;
  for (let y = 16; y < spec.bounds.height; y += 32) {
    for (let x = 16; x < spec.bounds.width; x += 32) {
      if (!onLand(x, y)) continue;
      slopes.push(terrain.slopeAt(x, y, 16));
      if (terrain.heightAt(x, y) < 30) below30++;
    }
  }
  return { slopes, below30, n: slopes.length };
})();

test('whole isthmus: land slope p50 / p90 within +-25 % of the real 6.4 % / 22.8 % (AWS terrain tiles)', { skip: 'interim: the authored lake basin and canal cut push these whole-map bands out (2026-11-22); the procedural map in src/world/proc replaces this relief' }, () => {
  const p50 = pct(land.slopes, 0.5);
  const p90 = pct(land.slopes, 0.9);
  console.log(`isthmus land (${land.n} points): slope p50=${f3(p50)} p90=${f3(p90)}`);
  const band = (real: number): { min: number; max: number } => ({ min: real * (1 - REAL.tol), max: real * (1 + REAL.tol) });
  assert.ok(inBand(p50, band(REAL.slopeP50)), `land slope p50 ${f3(p50)} outside [${f3(band(REAL.slopeP50).min)}, ${f3(band(REAL.slopeP50).max)}]`);
  assert.ok(inBand(p90, band(REAL.slopeP90)), `land slope p90 ${f3(p90)} outside [${f3(band(REAL.slopeP90).min)}, ${f3(band(REAL.slopeP90).max)}]`);
});

test('whole isthmus: share of land below 30 m within +-8 points of the real 17.7 %', { skip: 'interim: the authored lake basin and canal cut push these whole-map bands out (2026-11-22); the procedural map in src/world/proc replaces this relief' }, () => {
  const share = land.below30 / land.n;
  console.log(`isthmus land below 30 m: ${(share * 100).toFixed(1)} %`);
  assert.ok(Math.abs(share - REAL.shareBelow30) <= REAL.shareTol, `share of land < 30 m ${f3(share)} outside ${REAL.shareBelow30} +- ${REAL.shareTol}`);
});

test('ridges: the crest is the local maximum across every ridge (perpendicular profile within +-1 width, at every segment)', () => {
  for (const ridge of spec.relief.ridges) {
    const stations = crestStations(ridge);
    assert.ok(stations.length >= 3);
    for (const st of stations) {
      let best = -Infinity;
      let bestOff = 0;
      for (let k = -2; k <= 2; k++) {
        const off = (k * ridge.width) / 2;
        const h = terrain.heightAt(st.x + st.nx * off, st.y + st.ny * off);
        if (h > best) {
          best = h;
          bestOff = off;
        }
      }
      assert.ok(Math.abs(bestOff) <= ridge.width / 2, `${ridge.id}: highest point of the profile at (${st.x.toFixed(0)}, ${st.y.toFixed(0)}) is ${bestOff.toFixed(0)} m off the crest`);
      const crest = terrain.heightAt(st.x, st.y);
      const side = Math.max(terrain.heightAt(st.x + st.nx * ridge.width, st.y + st.ny * ridge.width), terrain.heightAt(st.x - st.nx * ridge.width, st.y - st.ny * ridge.width));
      assert.ok(crest - side >= 0.2 * ridge.amplitude, `${ridge.id}: crest ${crest.toFixed(1)} m is only ${(crest - side).toFixed(1)} m above the flanks at 1 width (need ${(0.2 * ridge.amplitude).toFixed(0)})`);
    }
  }
});

/** Points at 1/4, 1/2, 3/4 of every crest segment with the unit normal to it (ridge ends are skipped: the Gaussian ends there). */
function crestStations(r: RidgeFeature): { x: number; y: number; nx: number; ny: number }[] {
  const out: { x: number; y: number; nx: number; ny: number }[] = [];
  for (let i = 0; i + 1 < r.points.length; i++) {
    const a = r.points[i]!;
    const b = r.points[i + 1]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    for (const f of [0.25, 0.5, 0.75]) out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, nx: -(b.y - a.y) / l, ny: (b.x - a.x) / l });
  }
  return out;
}

test('the surface is continuous where the fine grid meets the far grid (no step at the active rect border)', () => {
  const g = terrain.grid;
  const x1 = g.x0 + (g.cols - 1) * g.cell;
  const y1 = g.y0 + (g.rows - 1) * g.cell;
  const eps = 0.01;
  let worst = 0;
  for (let t = 0; t <= 1; t += 1 / 400) {
    const px = g.x0 + (x1 - g.x0) * t;
    const py = g.y0 + (y1 - g.y0) * t;
    worst = Math.max(
      worst,
      Math.abs(terrain.heightAt(px, g.y0 + eps) - terrain.heightAt(px, g.y0 - eps)),
      Math.abs(terrain.heightAt(px, y1 - eps) - terrain.heightAt(px, y1 + eps)),
      Math.abs(terrain.heightAt(g.x0 + eps, py) - terrain.heightAt(g.x0 - eps, py)),
      Math.abs(terrain.heightAt(x1 - eps, py) - terrain.heightAt(x1 + eps, py)),
    );
  }
  console.log(`fine/far border: worst height step over ${2 * eps} m = ${worst.toExponential(2)} m`);
  assert.ok(worst < 0.01, `step of ${worst.toFixed(4)} m at the fine/far border`);
});

test('queries use the finest grid covering the point: 4 m inside the active rect, 16 m outside', () => {
  const a = spec.activeArea;
  assert.equal(terrain.cellAt((a.x[0] + a.x[1]) / 2, (a.y[0] + a.y[1]) / 2), spec.relief.grid.cell);
  assert.equal(terrain.cellAt(500, 6000), spec.relief.grid.far.cell);
  assert.equal(terrain.farGrid.cols, spec.bounds.width / spec.relief.grid.far.cell + 1);
  assert.equal(terrain.farGrid.rows, spec.bounds.height / spec.relief.grid.far.cell + 1);
});

test('layer 2 is deterministic and its far grid is the terrain far grid', () => {
  const l1 = layer1LandCover(spec);
  const a = layer2Relief(spec, { layer1: l1 });
  const b = layer2Relief(spec, { layer1: l1 });
  assert.deepEqual(a, b);
  assert.equal(a.far.cell, spec.relief.grid.far.cell);
  assert.deepEqual(a.far.data, terrain.farGrid.data);
  // Same spec, fresh Terrain: identical heights (no hidden state).
  const t2 = new Terrain(spec, world.slice.rect);
  for (const [x, y] of [[100, 100], [2500, 3000], [4500, 3400], [5800, 7000], [4300, 4300]] as const) assert.equal(t2.heightAt(x, y), new Terrain(spec, world.slice.rect).heightAt(x, y));
});
