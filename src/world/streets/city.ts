/**
 * City derivation from a street network (issue #7, S5):
 *   blocks → buildable area → land use → parcels (non park/court/median) → buildings.
 * Pure and deterministic: same spec + slice + network → deep-equal result. Randomness comes from
 * forks of createRng(blockout.seed): `landuse:<district>`, `parcels:<block id>`,
 * `buildings:<district>`.
 */
import type { WorldSpec } from '../spec.ts';
import type { WorldSlice } from '../slice.ts';
import { createRng } from '../rng.ts';
import type { StreetNetwork } from './generate.ts';
import type { BuildableArea, BuildableOptions } from './buildable.ts';
import { DEFAULT_BUILDABLE, buildKeepOuts, computeBuildable } from './buildable.ts';
import type { BlockLandUse } from './land-use.ts';
import { assignLandUse } from './land-use.ts';
import type { Parcel, ParcelParams } from './parcels.ts';
import { parcelParamsFromLot, subdividePart } from './parcels.ts';
import type { CityBuilding } from './buildings.ts';
import { placeBuildings } from './buildings.ts';
import { clipStats } from './poly.ts';

export interface City {
  /** Indexed by block id. */
  buildable: BuildableArea[];
  /** Indexed by block id. */
  landUse: BlockLandUse[];
  parcels: Parcel[];
  buildings: CityBuilding[];
  /**
   * polygon-clipping robustness during this derivation: `clipRetries` ops that threw and were
   * redone on a 1 mm grid; `clipFallbacks` ops that threw again and took the conservative path
   * (block without buildable area, piece left unsplit, part dropped). Expected 0 fallbacks.
   */
  stats: { clipRetries: number; clipFallbacks: number };
}

export interface CityOptions {
  buildable?: Partial<BuildableOptions>;
  /** Override the parcel parameters derived from blockout `lot` (per district id). */
  parcels?: Record<string, Partial<ParcelParams>>;
  /** Filled with phase timings (ms) when given. Not part of the (deterministic) result. */
  profile?: Record<string, number>;
}

const now = (): number => globalThis.performance?.now() ?? Date.now();

export function deriveCity(spec: WorldSpec, slice: WorldSlice, net: StreetNetwork, opts: CityOptions = {}): City {
  const bopts: BuildableOptions = { ...DEFAULT_BUILDABLE, ...opts.buildable };
  const root = createRng(spec.blockout.seed);
  const clip0 = { ...clipStats };
  let t0 = now();
  const mark = (name: string) => {
    if (!opts.profile) return;
    const t = now();
    opts.profile[name] = (opts.profile[name] ?? 0) + (t - t0);
    t0 = t;
  };
  const keepOuts = buildKeepOuts(spec, slice.rect, net.graph, bopts);
  const buildable = computeBuildable(net.blocks, net.graph, keepOuts, bopts);
  mark('buildable');
  const landUse = assignLandUse(spec, net.graph, net.blocks, buildable, slice.landmarks, root);
  mark('landUse');

  const parcels: Parcel[] = [];
  for (const block of net.blocks) {
    const use = (landUse[block.id] as BlockLandUse).use;
    if (use !== 'residential' && use !== 'commercial') continue;
    const district = block.district;
    const cfg = district !== undefined ? spec.blockout.districts[district] : undefined;
    if (!cfg || district === undefined) continue;
    const params = { ...parcelParamsFromLot(cfg.lot), ...opts.parcels?.[district] };
    const rng = root.fork(`parcels:${block.id}`);
    for (const part of (buildable[block.id] as BuildableArea).parts) {
      for (const p of subdividePart(part, params, keepOuts, rng)) {
        parcels.push({ id: parcels.length, block: block.id, district, ...p });
      }
    }
  }
  mark('parcels');
  const buildings = placeBuildings(spec, parcels, slice.landmarks, root);
  mark('buildings');
  const stats = { clipRetries: clipStats.retries - clip0.retries, clipFallbacks: clipStats.fallbacks - clip0.fallbacks };
  return { buildable, landUse, parcels, buildings, stats };
}
