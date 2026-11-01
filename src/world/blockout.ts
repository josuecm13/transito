import type { WorldSpec } from './spec.ts';
import { districtAt } from './spec.ts';
import type { WorldSlice } from './slice.ts';
import type { Vec2 } from './vec.ts';
import { distance } from './vec.ts';
import { distanceToPolyline, rotate } from './geometry.ts';
import { createRng } from './rng.ts';

export type Building = {
  center: Vec2;
  width: number;
  depth: number;
  height: number;
  /** Radians, counter-clockwise in the spec plane. */
  angle: number;
  district: string;
};

/** Corners of a building footprint, counter-clockwise starting at (-w/2, -d/2) in local space. */
export function buildingCorners(b: Pick<Building, 'center' | 'width' | 'depth' | 'angle'>): Vec2[] {
  const hw = b.width / 2;
  const hd = b.depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((c) => {
    const r = rotate(c, b.angle);
    return { x: b.center.x + r.x, y: b.center.y + r.y };
  });
}

/**
 * Seeded greybox buildings. Each district has its own rng fork and its own rotated lot grid.
 * RNG RULE: every candidate lot draws (fill, width, depth, height) in that fixed order, even if
 * the lot is rejected afterwards, so rejection rules never shift other lots' randomness.
 */
export function generateBlockout(spec: WorldSpec, slice: WorldSlice): Building[] {
  const out: Building[] = [];
  const root = createRng(spec.blockout.seed);
  const { rect } = slice;

  for (const [districtId, cfg] of Object.entries(spec.blockout.districts)) {
    const rng = root.fork('blockout:' + districtId);
    const angle = (cfg.angle * Math.PI) / 180;

    // Bounding box of the rect in lot space (grid rotated by `angle` about the origin).
    const inv = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ].map((c) => rotate(c, -angle));
    const minU = Math.min(...inv.map((p) => p.x));
    const maxU = Math.max(...inv.map((p) => p.x));
    const minV = Math.min(...inv.map((p) => p.y));
    const maxV = Math.max(...inv.map((p) => p.y));
    const i0 = Math.floor(minU / cfg.lot);
    const i1 = Math.ceil(maxU / cfg.lot);
    const j0 = Math.floor(minV / cfg.lot);
    const j1 = Math.ceil(maxV / cfg.lot);

    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const center = rotate({ x: (i + 0.5) * cfg.lot, y: (j + 0.5) * cfg.lot }, angle);
        if (districtAt(spec, center)?.id !== districtId) continue;

        // Fixed draw order for every candidate lot.
        const fillRoll = rng.next();
        const width = rng.range(cfg.footprint[0], cfg.footprint[1]);
        const depth = rng.range(cfg.footprint[0], cfg.footprint[1]);
        const height = rng.range(cfg.height[0], cfg.height[1]);

        if (fillRoll >= cfg.fill) continue;
        const b: Building = { center, width, depth, height, angle, district: districtId };
        if (!isValid(spec, slice, b, cfg.setback)) continue;
        out.push(b);
      }
    }
  }
  return out;
}

function isValid(spec: WorldSpec, slice: WorldSlice, b: Building, setback: number): boolean {
  const pts = [b.center, ...buildingCorners(b)];
  for (const p of pts) {
    if (!slice.isPlayableLand(p)) return false;
    if (districtAt(spec, p)?.id !== b.district) return false;
    for (const s of slice.streets) {
      if (distanceToPolyline(p, s.centerline) < s.width / 2 + s.sidewalk + setback) return false;
    }
  }
  for (const lm of slice.landmarks) {
    if (distance(b.center, lm.position) < spec.blockout.landmarkClearance) return false;
  }
  return true;
}
