/**
 * Coarse district influence model (#13, docs/map-reshape): a density field refined AFTER the settlement
 * envelope and the transit routing, so terrain, roads, towns and tracks are never recomputed (no circular
 * dependency). It is macro intent for #7 (street style), not streets.
 *
 *   D(p) = clamp( S(p) · G(p) · [ Σ_i w_i·g_i(p)·(1 + w_coast·C(p))  +  w_transit·T(p) ], 0, 1 )
 *
 *   S  terrain suitability (0 on water, steep ground, rivers, mangrove, the airfield and its buffer)
 *   G  access: access_floor + (1 − access_floor)·exp(−(d_road / access_range)²)
 *   g_i  district i: exp(−(d_i/σ_i)²), d_i = distance to its point, its route (`along`) or the airfield (`around`)
 *   C  coast: exp(−(d_sea/coast_sigma)²), only a multiplier inside districts (a bayfront boost, never a coastal sprawl)
 *   T  transit: max over metro stations of exp(−(d_station/transit_sigma)²) (max, so interchanges don't double count)
 *
 * Differs from the issue's sketch in one place: the coast term multiplies the district sum instead of adding
 * to it, otherwise every coastline would urbanise. With no items the field is zero (the feature is off).
 * Distinct overlapping influences, no rectangular or circular masks. Pure and deterministic.
 */
import type { Vec2 } from '../vec.ts';
import { cellAt, distanceFrom, field, mask, type FieldGrid, type GridShape, type MaskGrid } from './grid.ts';

export const DISTRICT_STYLES = ['historic-core', 'bayfront-linear', 'tower-cluster', 'hillside-lowrise', 'ribbon', 'port', 'buffer'] as const;
export type DistrictStyle = (typeof DISTRICT_STYLES)[number];

export interface DistrictItem {
  readonly id: string;
  readonly style: DistrictStyle;
  /** Where the influence is centred: a point, a road route (ribbon), or the airfield (a buffer). Exactly one. */
  readonly at?: Vec2;
  readonly along?: string;
  readonly around?: 'airport';
  /** Reach of the influence (m). */
  readonly sigma: number;
  /** Strength; negative pushes density away (an airport buffer). */
  readonly weight: number;
}

export interface DistrictParams {
  readonly transitWeight: number;
  readonly transitSigma: number;
  readonly coastWeight: number;
  readonly coastSigma: number;
  readonly accessFloor: number;
  readonly accessRange: number;
  /** A district counts as present where D ≥ this. */
  readonly footprint: number;
  /** Dense core (D ≥ 0.5) must stay this far from the airfield (m). */
  readonly airportCoreGap: number;
  readonly items: readonly DistrictItem[];
}

export interface DistrictInputs {
  readonly suitability: FieldGrid;
  /** Cells that may never carry density (rivers, mangrove, protected). */
  readonly blocked: MaskGrid;
  readonly roads: MaskGrid;
  readonly distToSea: FieldGrid;
  readonly stations: readonly Vec2[];
  /** Cells of each road route, by route id. */
  readonly routeCells: ReadonlyMap<string, readonly number[]>;
  readonly airfield: MaskGrid;
}

export interface DistrictsResult {
  /** D(p) ∈ [0, 1]; all zero when there are no items. */
  readonly density: FieldGrid;
  /** Index + 1 of the item with the largest positive term at each cell where D ≥ footprint; 0 elsewhere. */
  readonly dominant: Uint8Array;
  /** Area where D ≥ footprint and the item dominates (km²), per item in order. */
  readonly areasKm2: readonly number[];
  readonly ids: readonly string[];
  /** Area where D ≥ 0.5 (km²). */
  readonly denseKm2: number;
}

const gauss = (d: number, sigma: number): number => Math.exp(-((d / sigma) ** 2));

export function growDistricts(shape: GridShape, p: DistrictParams, inp: DistrictInputs): DistrictsResult {
  const { w, h, cell } = shape;
  const n = w * h;
  const density = field(shape);
  const dominant = new Uint8Array(n);
  const ids = p.items.map((d) => d.id);
  if (p.items.length === 0) return { density, dominant, areasKm2: [], ids, denseKm2: 0 };

  const distTo: FieldGrid[] = p.items.map((it) => {
    const src = mask(shape);
    if (it.at) src.data[cellAt(shape, it.at.x, it.at.y)] = 1;
    else if (it.along) for (const c of inp.routeCells.get(it.along) ?? []) src.data[c] = 1;
    else if (it.around) src.data.set(inp.airfield.data);
    return distanceFrom(src);
  });
  const roadD = distanceFrom(inp.roads);
  const stationMask = mask(shape);
  for (const s of inp.stations) stationMask.data[cellAt(shape, s.x, s.y)] = 1;
  const stationD = inp.stations.length ? distanceFrom(stationMask) : undefined;

  const areas = p.items.map(() => 0);
  let dense = 0;
  for (let i = 0; i < n; i++) {
    const s = inp.suitability.data[i]!;
    if (s <= 0 || inp.blocked.data[i] || inp.airfield.data[i]) continue;
    const access = p.accessFloor + (1 - p.accessFloor) * gauss(roadD.data[i]!, p.accessRange);
    const coast = 1 + p.coastWeight * gauss(inp.distToSea.data[i]!, p.coastSigma);
    let sum = 0;
    let best = 0;
    let bestK = -1;
    for (let k = 0; k < p.items.length; k++) {
      const it = p.items[k]!;
      const term = it.weight * gauss(distTo[k]!.data[i]!, it.sigma);
      sum += term;
      if (term > best) {
        best = term;
        bestK = k;
      }
    }
    const transit = stationD ? p.transitWeight * gauss(stationD.data[i]!, p.transitSigma) : 0;
    const d = Math.min(1, Math.max(0, s * access * (sum * coast + transit)));
    density.data[i] = d;
    if (d >= p.footprint && bestK >= 0) {
      dominant[i] = bestK + 1;
      areas[bestK] = areas[bestK]! + 1;
    }
    if (d >= 0.5) dense++;
  }
  const km2 = (c: number): number => (c * cell * cell) / 1e6;
  return { density, dominant, areasKm2: areas.map(km2), ids, denseKm2: km2(dense) };
}
