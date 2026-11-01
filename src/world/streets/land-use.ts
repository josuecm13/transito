/**
 * Land use per block (issue #7, S5).
 *
 * Per district (street_styles.districts.<id>.land_use = { park, court } fractions):
 *   N        = blocks of the district that are not medians (have buildable area)
 *   courts   = round(court · N), parks = round(park · N)   (Math.round; fewer only if not enough
 *              eligible blocks exist)
 *   eligible = not a median, contains no landmark, and no landmark trigger circle
 *              (trigger_radius) reaches it.
 * Courts are chosen first among eligible blocks whose buildable area is "small-medium":
 * COURT_MIN_AREA <= area <= 1.5 × the district's median buildable area (rng-shuffled), then from
 * the remaining eligible blocks by ascending area. Parks are then chosen from eligible blocks with
 * area <= 4 × the median (shuffled), then any remaining eligible block (shuffled) — so a giant
 * avenue-bounded block only becomes a park when nothing else is left.
 * Every other non-median block is `commercial` if any edge of its boundary is an avenue, else
 * `residential`. Medians are `median`. Park / court / median blocks get no parcels or buildings.
 */
import type { WorldSpec } from '../spec.ts';
import type { Landmark } from '../spec.ts';
import type { Rng } from '../rng.ts';
import type { GraphSnapshot } from './planar-graph.ts';
import type { Block } from './faces.ts';
import type { BuildableArea } from './buildable.ts';
import { blockPoly } from './buildable.ts';
import { distToBoundary, pointInPoly } from './poly.ts';

export type LandUseKind = 'park' | 'court' | 'commercial' | 'residential' | 'median';

export interface BlockLandUse {
  block: number;
  district: string | undefined;
  use: LandUseKind;
}

/** Smallest buildable area that fits a court (m²): ~ a 40 × 20 m futsal court minus margins. */
export const COURT_MIN_AREA = 600;

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Block touches a landmark: contains its position, or its trigger circle reaches the block. */
export function blockHasLandmark(block: Block, landmarks: readonly Landmark[]): boolean {
  const poly = blockPoly(block);
  for (const lm of landmarks) {
    if (pointInPoly(lm.position, poly)) return true;
    if (lm.triggerRadius !== undefined && distToBoundary(lm.position, poly) < lm.triggerRadius) return true;
  }
  return false;
}

export function assignLandUse(
  spec: WorldSpec,
  graph: GraphSnapshot,
  blocks: readonly Block[],
  buildable: readonly BuildableArea[],
  landmarks: readonly Landmark[],
  root: Rng,
): BlockLandUse[] {
  const fronting = (b: Block) => b.boundary.some((r) => graph.edges[r.edge]?.cls === 'avenue');
  const uses: BlockLandUse[] = blocks.map((b) => ({
    block: b.id,
    district: b.district,
    use: (buildable[b.id] as BuildableArea).isMedian ? 'median' : fronting(b) ? 'commercial' : 'residential',
  }));
  const areaOf = (b: Block) => (buildable[b.id] as BuildableArea).area;
  for (const id of Object.keys(spec.streetStyles.districts).sort()) {
    const lu = spec.streetStyles.districts[id]?.landUse;
    if (!lu) continue;
    const rng = root.fork('landuse:' + id);
    const live = blocks.filter((b) => b.district === id && !(buildable[b.id] as BuildableArea).isMedian);
    if (live.length === 0) continue;
    const nCourt = Math.round(lu.court * live.length);
    const nPark = Math.round(lu.park * live.length);
    const areas = live.map(areaOf).sort((p, q) => p - q);
    const median = areas[Math.floor(areas.length / 2)] as number;
    const eligible = live.filter((b) => !blockHasLandmark(b, landmarks));
    const taken = new Set<number>();
    const take = (cands: readonly Block[], n: number, use: LandUseKind): number => {
      let k = 0;
      for (const b of cands) {
        if (k >= n) break;
        if (taken.has(b.id)) continue;
        taken.add(b.id);
        (uses[b.id] as BlockLandUse).use = use;
        k++;
      }
      return k;
    };
    const courtFit = eligible.filter((b) => areaOf(b) >= COURT_MIN_AREA && areaOf(b) <= 1.5 * median);
    const c1 = take(shuffled(courtFit, rng), nCourt, 'court');
    take([...eligible].sort((p, q) => areaOf(p) - areaOf(q) || p.id - q.id), nCourt - c1, 'court');
    const parkFit = eligible.filter((b) => areaOf(b) <= 4 * median);
    const p1 = take(shuffled(parkFit, rng), nPark, 'park');
    take(shuffled(eligible, rng), nPark - p1, 'park');
  }
  return uses;
}
