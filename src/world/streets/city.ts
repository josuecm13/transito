/**
 * City derivation from a street network (issue #7, S5):
 *   blocks → buildable area → land use → parcels (non park/court/median) → buildings.
 * Pure and deterministic: same spec + slice + network → deep-equal result. Randomness comes from
 * forks of createRng(blockout.seed): `landuse:<district>`, `parcels:<block id>`,
 * `buildings:<district>`, `frontage:<block id>`.
 * A district with `method: frontage-lots` skips parcels: its blocks get lots laid along their
 * street frontage (frontage-lots.ts) and the buildings carry `parcel: -1`.
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
import { distToRing, placeBuildings } from './buildings.ts';
import { buildingCorners } from '../blockout.ts';
import { frontageEdgesOfParts, frontageLots } from './frontage-lots.ts';
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

/**
 * A block of a built district (one with a `blockout.districts` entry): its ground is city ground.
 * Any other face of the street graph (wild land closed by the active-area frame, a highway or a
 * runway) is not a city block: the land cover shows there.
 */
export function isCityBlock(spec: WorldSpec, block: { district?: string | undefined }): boolean {
  return block.district !== undefined && spec.blockout.districts[block.district] !== undefined;
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
    if (!cfg || district === undefined || cfg.method === 'frontage-lots') continue;
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
  for (const block of net.blocks) {
    const use = (landUse[block.id] as BlockLandUse).use;
    if (use !== 'residential' && use !== 'commercial') continue;
    const district = block.district;
    const cfg = district !== undefined ? spec.blockout.districts[district] : undefined;
    if (!cfg || district === undefined || cfg.method !== 'frontage-lots' || !cfg.frontageLots) continue;
    const parts = (buildable[block.id] as BuildableArea).parts;
    const edges = frontageEdgesOfParts(parts, keepOuts);
    for (const lot of frontageLots({ parts, edges, cfg: cfg.frontageLots, rng: root.fork(`frontage:${block.id}`), key: String(block.id) })) {
      const b = { center: lot.center, width: lot.width, depth: lot.depth, angle: lot.angle };
      const ring = buildingCorners(b);
      if (slice.landmarks.some((lm) => distToRing(lm.position, ring) < spec.blockout.landmarkClearance)) continue;
      buildings.push({ ...b, height: lot.height, district, parcel: -1, block: block.id });
    }
  }
  mark('buildings');
  const stats = { clipRetries: clipStats.retries - clip0.retries, clipFallbacks: clipStats.fallbacks - clip0.fallbacks };
  return { buildable, landUse, parcels, buildings, stats };
}
