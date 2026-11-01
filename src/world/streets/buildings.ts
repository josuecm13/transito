/**
 * Buildings (issue #7, S5): at most one per parcel, fitted inside it, facing its frontage street.
 *
 * Per-district numbers come from `blockout.districts.<id>` (footprint, height, setback, fill) and
 * `blockout.landmark_clearance`; nothing is duplicated here.
 *
 * RNG RULE (same as generateBlockout): every parcel draws (fill, width, depth, height) in that
 * fixed order from its district's fork before any rejection, so rejection rules never shift other
 * parcels' randomness.
 *
 * Fitting, in the parcel's frontage frame (u along the frontage edge, n into the parcel):
 *   width (along u)  = min(drawn width,  frontage edge length − 2·SIDE_GAP)
 *   depth (along n)  = min(drawn depth,  parcel depth beyond the setback − REAR_GAP)
 *   front face at `setback` m from the frontage edge, centred on it.
 * If the rectangle is not inside the parcel with CLEARANCE m to spare, both sides shrink by 15%
 * per try (4 tries) down to MIN_SCALE · footprint min; otherwise the parcel stays empty.
 * A building whose footprint comes within landmark_clearance of a landmark is dropped.
 */
import type { BlockoutDistrict, WorldSpec } from '../spec.ts';
import type { Vec2 } from '../vec.ts';
import type { Rng } from '../rng.ts';
import type { Building } from '../blockout.ts';
import { buildingCorners } from '../blockout.ts';
import type { Parcel } from './parcels.ts';
import { pointInPolygon } from '../geometry.ts';
import { distToSegment, ringCentroid, ringInsidePoly } from './poly.ts';

/** Superset of the blockout Building: renderers / physics can consume it unchanged. */
export interface CityBuilding extends Building {
  parcel: number;
  block: number;
}

const SIDE_GAP = 1;
const REAR_GAP = 1;
const CLEARANCE = 0.25;
const MIN_SCALE = 0.6;

/** Distance from p to a convex footprint (0 inside). */
function distToRing(p: Vec2, ring: readonly Vec2[]): number {
  if (pointInPolygon(p, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, distToSegment(p, ring[i] as Vec2, ring[(i + 1) % ring.length] as Vec2));
  return best;
}

export function fitBuilding(
  parcel: Parcel,
  cfg: Pick<BlockoutDistrict, 'footprint' | 'setback'>,
  drawn: { width: number; depth: number },
): { center: Vec2; width: number; depth: number; angle: number } | undefined {
  const { a, b } = parcel.frontage;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return undefined;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  let n = { x: -u.y, y: u.x };
  const c = ringCentroid(parcel.poly.outer);
  if ((c.x - a.x) * n.x + (c.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  let maxN = 0;
  for (const q of parcel.poly.outer) maxN = Math.max(maxN, (q.x - a.x) * n.x + (q.y - a.y) * n.y);
  const minDim = MIN_SCALE * cfg.footprint[0];
  let width = Math.min(drawn.width, len - 2 * SIDE_GAP);
  let depth = Math.min(drawn.depth, maxN - cfg.setback - REAR_GAP);
  const angle = Math.atan2(u.y, u.x);
  for (let k = 0; k < 5; k++) {
    if (width < minDim || depth < minDim) return undefined;
    const center = {
      x: a.x + u.x * (len / 2) + n.x * (cfg.setback + depth / 2),
      y: a.y + u.y * (len / 2) + n.y * (cfg.setback + depth / 2),
    };
    const b0 = { center, width, depth, angle };
    if (ringInsidePoly(buildingCorners(b0), parcel.poly, CLEARANCE)) return b0;
    width *= 0.85;
    depth *= 0.85;
  }
  return undefined;
}

export function placeBuildings(spec: WorldSpec, parcels: readonly Parcel[], landmarks: readonly { position: Vec2 }[], root: Rng): CityBuilding[] {
  const out: CityBuilding[] = [];
  const forks = new Map<string, Rng>();
  const clearance = spec.blockout.landmarkClearance;
  for (const p of parcels) {
    const cfg = spec.blockout.districts[p.district];
    if (!cfg) continue;
    let rng = forks.get(p.district);
    if (!rng) {
      rng = root.fork('buildings:' + p.district);
      forks.set(p.district, rng);
    }
    const fillRoll = rng.next();
    const width = rng.range(cfg.footprint[0], cfg.footprint[1]);
    const depth = rng.range(cfg.footprint[0], cfg.footprint[1]);
    const height = rng.range(cfg.height[0], cfg.height[1]);
    if (fillRoll >= cfg.fill) continue;
    const fit = fitBuilding(p, cfg, { width, depth });
    if (!fit) continue;
    const corners = buildingCorners(fit);
    if (landmarks.some((lm) => distToRing(lm.position, corners) < clearance)) continue;
    out.push({ ...fit, height, district: p.district, parcel: p.id, block: p.block });
  }
  return out;
}
