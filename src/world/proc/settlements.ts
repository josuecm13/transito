/**
 * Settlement growth (docs/map-reshape/01-investigation/procedural-techniques.md §6).
 *
 * suitability(cell) ∈ [0, 1]: flat, dry, low, not too far from the coast; zero on water and steep
 * ground. Towns grow from seeds by multi-source cost-distance accretion (an Eden-like process with a
 * random metric): step cost = jitter / suitability, much cheaper along main roads. Each town stops at
 * its target area. Edges come out ragged (jitter), towns fill valleys and plains (suitability) and
 * stretch along highways (road discount) — the ribbon of El Corredor is the same rule as the cities.
 */
import type { Vec2 } from '../vec.ts';
import { cellAt, DIST8, DX8, DY8, field, MinHeap, type FieldGrid, type MaskGrid } from './grid.ts';
import { fbm, hash01 } from './noise.ts';

export interface SuitabilityParams {
  /** Slope where suitability reaches 0 (m/m). */
  readonly maxSlope: number;
  /** Height above which suitability starts falling, and where it reaches 0 (m). */
  readonly heightBand: readonly [number, number];
  /** Coastal preference: suitability *= 1 - coastFade · smoothstep(0, coastRange, distToSea). */
  readonly coastFade: number;
  readonly coastRange: number;
  /** Suitability given to crossable cells (rivers): low, so towns bridge them but prefer not to. */
  readonly crossing: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * `water` cells (sea, lake, canal, airfield) are never built and block growth. `crossable` cells
 * (rivers) are not built either, but growth may cross them (bridges): they get `p.crossing` suitability
 * and are cleared from the result by growTowns' caller.
 */
export function suitability(height: FieldGrid, slope: FieldGrid, land: MaskGrid, water: MaskGrid, crossable: MaskGrid, distToSea: FieldGrid, p: SuitabilityParams): FieldGrid {
  const out = field(height);
  for (let i = 0; i < out.data.length; i++) {
    if (!land.data[i] || water.data[i]) continue;
    if (crossable.data[i]) {
      out.data[i] = p.crossing;
      continue;
    }
    const s = 1 - smoothstep(0, p.maxSlope, slope.data[i]!);
    const h = 1 - smoothstep(p.heightBand[0], p.heightBand[1], height.data[i]!);
    const c = 1 - p.coastFade * smoothstep(0, p.coastRange, distToSea.data[i]!);
    out.data[i] = s * h * c;
  }
  return out;
}

export interface TownSpec {
  readonly id: string;
  readonly seeds: readonly Vec2[];
  readonly targetKm2: number;
  /** Multiplier on the road discount for this town (1 = default; higher = more ribbon-like). */
  readonly roadAffinity?: number;
}

export interface GrowthParams {
  readonly towns: readonly TownSpec[];
  /** Step-cost multiplier on cells near a main road (< 1). */
  readonly roadDiscount: number;
  /** Jitter: cost *= exp(amp · n) with n mixing per-cell hash and fbm, for ragged but coherent edges. */
  readonly jitter: number;
  readonly jitterWavelength: number;
  /** Cells with suitability below this are never built. */
  readonly minSuitability: number;
  /** Seeds move to the most suitable cell within this radius (m). */
  readonly seedSnap: number;
  readonly seed: number;
}

export interface GrowthResult {
  /** Town index + 1 per cell, 0 = unbuilt. */
  readonly owner: Uint8Array;
  /** Urban density 0..1 (dense core, sparse edge). */
  readonly density: FieldGrid;
  readonly areasKm2: readonly number[];
}

/**
 * `nearRoad[k]` is the road-proximity mask town k gets its discount on (a ribbon town only follows its
 * own highway; a city benefits from all roads).
 */
export function growTowns(suit: FieldGrid, nearRoad: readonly MaskGrid[], p: GrowthParams, unbuilt?: MaskGrid): GrowthResult {
  const { w, h, cell } = suit;
  const n = w * h;
  const T = p.towns.length;
  const owner = new Uint8Array(n);
  // One cost-distance per town; towns compete only for ownership (first to reach a cell keeps it).
  const dist = new Float64Array(n * T).fill(Number.POSITIVE_INFINITY);
  const order = new Float64Array(n);
  const counts = p.towns.map(() => 0);
  const targets = p.towns.map((t) => (t.targetKm2 * 1e6) / (cell * cell));
  const heap = new MinHeap(4096);
  const snap = (s: Vec2): number => {
    const c = cellAt(suit, s.x, s.y);
    const r = Math.ceil(p.seedSnap / cell);
    const cx = c % w;
    const cy = (c - cx) / w;
    let best = c;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h || dx * dx + dy * dy > r * r) continue;
        const j = y * w + x;
        if (suit.data[j]! > suit.data[best]! + 1e-9) best = j;
      }
    return best;
  };
  p.towns.forEach((t, k) => {
    for (const s of t.seeds) {
      const i = snap(s);
      dist[k * n + i] = 0;
      heap.push(k * n + i, 0);
    }
  });
  const stepCost = (i: number, k: number): number => {
    const s = suit.data[i]!;
    if (s < p.minSuitability) return Number.POSITIVE_INFINITY;
    const x = (i % w) * cell;
    const y = Math.floor(i / w) * cell;
    const noise = 0.6 * fbm(x, y, { wavelength: p.jitterWavelength, octaves: 3 }, p.seed) + 0.8 * (hash01(i, p.seed + 1) - 0.5);
    let c = Math.exp(p.jitter * noise) / s;
    if (nearRoad[k]!.data[i]) c *= Math.pow(p.roadDiscount, p.towns[k]!.roadAffinity ?? 1);
    return c;
  };
  while (heap.size > 0) {
    const d0 = heap.topKey();
    const item = heap.pop();
    const k = Math.floor(item / n);
    const c = item - k * n;
    if (d0 > dist[item]! || owner[c] || counts[k]! >= targets[k]!) continue;
    owner[c] = k + 1;
    order[c] = counts[k]! / targets[k]!;
    counts[k] = counts[k]! + 1;
    const cx = c % w;
    const cy = (c - cx) / w;
    for (let q = 0; q < 8; q++) {
      const nx = cx + DX8[q]!;
      const ny = cy + DY8[q]!;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (owner[j]) continue;
      const sc = stepCost(j, k);
      if (!Number.isFinite(sc)) continue;
      const t = d0 + sc * DIST8[q]!;
      if (t < dist[k * n + j]!) {
        dist[k * n + j] = t;
        heap.push(k * n + j, t);
      }
    }
  }
  if (unbuilt) for (let i = 0; i < n; i++) if (unbuilt.data[i]) owner[i] = 0;
  const density = field(suit);
  // Areas from the final ownership: crossed river cells were grown through but are not built.
  const built = p.towns.map(() => 0);
  for (let i = 0; i < n; i++) {
    const k = owner[i]!;
    if (!k) continue;
    density.data[i] = 0.35 + 0.65 * (1 - Math.sqrt(order[i]!));
    built[k - 1] = built[k - 1]! + 1;
  }
  return { owner, density, areasKm2: built.map((c) => (c * cell * cell) / 1e6) };
}
