/**
 * Land cover classification from the derived fields (no painted zones):
 * beach (thin, flat, at the shore), mangrove (low, near river mouths), clearings (noise patches that
 * favour flat lowland and town fringes), high forest (steep or high), forest elsewhere, paved (airfield).
 */
import type { Vec2 } from '../vec.ts';
import { centreX, centreY, type FieldGrid, type MaskGrid } from './grid.ts';
import { fbm } from './noise.ts';
import { COVER_BEACH, COVER_CLEARING, COVER_FOREST, COVER_HIGH_FOREST, COVER_MANGROVE, COVER_PAVED } from './render.ts';

export interface CoverParams {
  readonly seed: number;
  readonly beachWidth: number;
  readonly mangrove: { readonly maxHeight: number; readonly riverAreaKm2: number; readonly reach: number };
  readonly clearing: { readonly wavelength: number; readonly threshold: number; readonly lowlandBonus: number; readonly fringeBonus: number };
  readonly highForest: { readonly height: number; readonly slope: number };
}

function inRing(x: number, y: number, ring: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function classifyCover(
  height: FieldGrid,
  slope: FieldGrid,
  land: MaskGrid,
  distToSea: FieldGrid,
  area: Float64Array,
  urban: FieldGrid,
  paved: readonly (readonly Vec2[])[],
  p: CoverParams,
): Uint8Array {
  const { w, h } = height;
  const out = new Uint8Array(w * h);
  // Distance (cells) to a large river near the coast, by a small dilation of river-mouth cells.
  const mouthR = Math.ceil(p.mangrove.reach / height.cell);
  const nearMouth = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!land.data[i] || area[i]! < p.mangrove.riverAreaKm2 * 1e6 || distToSea.data[i]! > p.mangrove.reach * 2) continue;
    const x0 = i % w;
    const y0 = (i - x0) / w;
    for (let dy = -mouthR; dy <= mouthR; dy++)
      for (let dx = -mouthR; dx <= mouthR; dx++) {
        const x = x0 + dx;
        const y = y0 + dy;
        if (x >= 0 && y >= 0 && x < w && y < h && dx * dx + dy * dy <= mouthR * mouthR) nearMouth[y * w + x] = 1;
      }
  }
  // Urban fringe: blurred urban presence boosts clearings around towns.
  for (let gy = 0; gy < h; gy++) {
    for (let gx = 0; gx < w; gx++) {
      const i = gy * w + gx;
      if (!land.data[i]) continue;
      const x = centreX(height, gx);
      const y = centreY(height, gy);
      if (paved.some((r) => inRing(x, y, r))) {
        out[i] = COVER_PAVED;
        continue;
      }
      const hh = height.data[i]!;
      const sl = slope.data[i]!;
      const ds = distToSea.data[i]!;
      if (ds < p.beachWidth && sl < 0.08 && hh < 5) {
        out[i] = COVER_BEACH;
        continue;
      }
      if (nearMouth[i] && hh < p.mangrove.maxHeight && ds < p.mangrove.reach * 2) {
        out[i] = COVER_MANGROVE;
        continue;
      }
      const lowland = 1 - Math.min(1, sl / 0.12);
      const fringe = urban.data[i]!;
      const c = fbm(x, y, { wavelength: p.clearing.wavelength, octaves: 4, gain: 0.55 }, p.seed) + p.clearing.lowlandBonus * lowland + p.clearing.fringeBonus * fringe;
      if (c > p.clearing.threshold) {
        out[i] = COVER_CLEARING;
        continue;
      }
      out[i] = hh > p.highForest.height || sl > p.highForest.slope ? COVER_HIGH_FOREST : COVER_FOREST;
    }
  }
  return out;
}
