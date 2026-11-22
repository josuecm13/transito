/**
 * Relief from a tectonic plan (docs/map-reshape/01-investigation/procedural-techniques.md §1).
 *
 * The spec gives only coarse intent: where rock rises (uplift zones) and the coast. Ridged, warped,
 * anisotropic noise modulates the uplift; stream-power erosion then carves the drainage network.
 * Ridges, spurs, valleys and their branching come out of the erosion, not out of drawn shapes.
 */
import { pointInPolygon } from '../geometry.ts';
import type { Vec2 } from '../vec.ts';
import { blur, centreX, centreY, distanceFrom, field, mask, type FieldGrid, type GridShape, type MaskGrid } from './grid.ts';
import { accumulate, erode, routeFlow, slopeField, type ErosionParams, type ErosionResult } from './hydrology.ts';
import { anisotropic, fbm, hash01, ridged, warp, type Octaves } from './noise.ts';

export type UpliftZone =
  | { readonly id: string; readonly kind: 'line'; readonly points: readonly Vec2[]; readonly width: number; readonly rate: number }
  | { readonly id: string; readonly kind: 'disc'; readonly at: Vec2; readonly radius: number; readonly rate: number };

export interface ReliefParams {
  readonly seed: number;
  /** Uplift rate where no zone applies. */
  readonly background: number;
  readonly zones: readonly UpliftZone[];
  /** Noise modulation of the uplift: rate *= lo + (hi - lo) * ridged(warped p). */
  readonly modulation: { readonly lo: number; readonly hi: number; readonly octaves: Octaves; readonly warp: number; readonly grainDeg: number; readonly grainRatio: number };
  /** Uplift fades to zero over this distance from the sea (m), so coastal plains form. */
  readonly coastTaper: number;
  /** Coastline wobble: amplitude (m) and noise of the signed-distance perturbation. */
  readonly coastWobble: { readonly amplitude: number; readonly octaves: Octaves };
  readonly erosion: ErosionParams;
  /** Final land heights are scaled so this quantile of land cells sits at `peak` metres. */
  readonly peak: number;
  readonly peakQuantile: number;
  /** Sea floor: depth (m) right at the shore and slope (m/m) offshore. */
  readonly seaFloor: { readonly shore: number; readonly slope: number };
  /**
   * Low hills on inland valley floors (metres), added after erosion: weight rises with distance from
   * the sea (`inland` m ramp) and falls with slope. Flooding later turns their tops into islands.
   */
  readonly hummocks: { readonly amplitude: number; readonly octaves: Octaves; readonly inland: readonly [number, number]; readonly maxSlope: number };
}

export interface CoastInput {
  readonly land: readonly Vec2[];
  readonly islands: readonly (readonly Vec2[])[];
}

/**
 * Distance from p to the ring's shore edges. Edges lying on the map border (land that continues past
 * the frame) are not shore and are skipped.
 */
function distToRing(px: number, py: number, ring: readonly Vec2[], bw: number, bh: number): number {
  let best = Number.POSITIVE_INFINITY;
  const onBorder = (a: Vec2, b: Vec2): boolean =>
    (a.x <= 0 && b.x <= 0) || (a.x >= bw && b.x >= bw) || (a.y <= 0 && b.y <= 0) || (a.y >= bh && b.y >= bh);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    if (onBorder(a, b)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(px - a.x - t * dx, py - a.y - t * dy));
  }
  return best;
}

function distToPolyline(px: number, py: number, line: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(px - a.x - t * dx, py - a.y - t * dy));
  }
  return best;
}

/**
 * Land mask: inside the coast polygon or an island, with the signed distance to the shore perturbed
 * by fractal noise so the raster coast is not a polygon outline. The authored shape is kept within
 * ± amplitude metres.
 */
export function landMask(shape: GridShape, coast: CoastInput, p: Pick<ReliefParams, 'coastWobble' | 'seed'>): { land: MaskGrid; shore: FieldGrid } {
  const out = mask(shape);
  const shore = field(shape);
  const rings = [coast.land, ...coast.islands];
  for (let gy = 0; gy < shape.h; gy++) {
    const y = centreY(shape, gy);
    for (let gx = 0; gx < shape.w; gx++) {
      const x = centreX(shape, gx);
      const pt = { x, y };
      let inside = false;
      let d = Number.POSITIVE_INFINITY;
      for (const ring of rings) {
        if (pointInPolygon(pt, ring as Vec2[])) inside = true;
        d = Math.min(d, distToRing(x, y, ring, shape.w * shape.cell, shape.h * shape.cell));
      }
      const signed = inside ? d : -d;
      const wob = p.coastWobble.amplitude * fbm(x, y, p.coastWobble.octaves, p.seed + 404);
      out.data[gy * shape.w + gx] = signed + wob > 0 ? 1 : 0;
      shore.data[gy * shape.w + gx] = signed + wob;
    }
  }
  return { land: out, shore };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Uplift rate field: zones (smooth falloff), noise-modulated, tapered to zero at the coast. */
export function upliftField(land: MaskGrid, distToSea: FieldGrid, p: ReliefParams): FieldGrid {
  const out = field(land);
  const m = p.modulation;
  const grain = (m.grainDeg * Math.PI) / 180;
  for (let gy = 0; gy < land.h; gy++) {
    const y = centreY(land, gy);
    for (let gx = 0; gx < land.w; gx++) {
      const i = gy * land.w + gx;
      if (!land.data[i]) continue;
      const x = centreX(land, gx);
      let rate = p.background;
      for (const z of p.zones) {
        const d = z.kind === 'line' ? distToPolyline(x, y, z.points) : Math.hypot(x - z.at.x, y - z.at.y);
        const r = z.kind === 'line' ? z.width : z.radius;
        // Smooth bump: 1 at the axis, 0 at distance r (cosine falloff), combined by max.
        const t = d >= r ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / r);
        rate = Math.max(rate, z.rate * t);
      }
      const [wx, wy] = warp(x, y, { wavelength: m.octaves.wavelength * 2.5, octaves: 3 }, m.warp, p.seed + 55);
      const [ax, ay] = anisotropic(wx, wy, grain, m.grainRatio);
      const mod = m.lo + (m.hi - m.lo) * ridged(ax, ay, m.octaves, p.seed + 77);
      out.data[i] = rate * mod * smoothstep(0, p.coastTaper, distToSea.data[i]!);
    }
  }
  return out;
}

export interface ReliefResult extends ErosionResult {
  readonly land: MaskGrid;
  /** Signed distance to the shore (m, + on land), smooth: use it to draw the coast below cell size. */
  readonly shore: FieldGrid;
  readonly uplift: FieldGrid;
  readonly distToSea: FieldGrid;
}

/** Full relief: land mask → uplift → erosion → scale to metres → sea floor. Pure. */
export function generateRelief(shape: GridShape, coast: CoastInput, p: ReliefParams): ReliefResult {
  const { land, shore } = landMask(shape, coast, p);
  const sea = mask(shape);
  for (let i = 0; i < sea.data.length; i++) sea.data[i] = land.data[i] ? 0 : 1;
  const distToSea = distanceFrom(sea);
  const uplift = upliftField(land, distToSea, p);
  // Initial surface: a gentle seaward ramp plus small noise, so drainage has somewhere to organise from.
  const init = field(shape);
  for (let gy = 0; gy < shape.h; gy++) {
    for (let gx = 0; gx < shape.w; gx++) {
      const i = gy * shape.w + gx;
      if (!land.data[i]) continue;
      const n = fbm(centreX(shape, gx), centreY(shape, gy), { wavelength: 400, octaves: 4 }, p.seed + 9);
      init.data[i] = 0.002 * distToSea.data[i]! + 1.5 + n + 0.3 * hash01(i, p.seed + 31);
    }
  }
  const res = erode(init, sea, uplift, p.erosion);
  // Scale land heights to metres.
  const hd = res.height.data;
  const landHeights: number[] = [];
  for (let i = 0; i < hd.length; i++) if (land.data[i]) landHeights.push(hd[i]!);
  landHeights.sort((a, b) => a - b);
  const q = landHeights[Math.floor((landHeights.length - 1) * p.peakQuantile)] ?? 1;
  const scale = q > 0 ? p.peak / q : 1;
  const landDist = distanceFrom(land);
  for (let i = 0; i < hd.length; i++) {
    hd[i] = land.data[i] ? Math.max(0.3, hd[i]! * scale) : -(p.seaFloor.shore + p.seaFloor.slope * landDist.data[i]!);
  }
  // Hummocks on low-gradient inland ground (computed on the eroded slope, before they are added).
  const slope = slopeField(blurLand(res.height, 3));
  const hm = p.hummocks;
  for (let gy = 0; gy < shape.h; gy++) {
    for (let gx = 0; gx < shape.w; gx++) {
      const i = gy * shape.w + gx;
      if (!land.data[i]) continue;
      const wIn = smoothstep(hm.inland[0], hm.inland[1], distToSea.data[i]!);
      const wFlat = 1 - smoothstep(hm.maxSlope * 0.3, hm.maxSlope, slope.data[i]!);
      if (wIn * wFlat <= 0) continue;
      const b = fbm(centreX(shape, gx), centreY(shape, gy), hm.octaves, p.seed + 606);
      hd[i] = hd[i]! + hm.amplitude * wIn * wFlat * Math.max(-0.3, b);
    }
  }
  // Routing and area of the final surface.
  const routing = routeFlow(res.height, sea);
  const area = accumulate(routing, shape.cell, hd.length);
  return { height: res.height, routing, area, land, shore, uplift, distToSea };
}

function blurLand(f: FieldGrid, r: number): FieldGrid {
  return blur(f, r, 1);
}
