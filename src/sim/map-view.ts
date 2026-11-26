import type { Vec2 } from '../world/vec.ts';
import type { Rect } from '../world/geometry.ts';

/**
 * North-up 2D map view. `center` (spec meters, +y north) sits at the viewport center;
 * `metersPerPx` is the zoom (smaller = closer). Screen pixels: origin top-left, +y down.
 */
export type MapView = { center: Vec2; metersPerPx: number };
export type Viewport = { w: number; h: number };
/** Bounds on `metersPerPx`: `min` = closest zoom, `max` = farthest. */
export type ZoomLimits = { min: number; max: number };

export function worldToScreen(view: MapView, p: Vec2, vp: Viewport): Vec2 {
  return {
    x: vp.w / 2 + (p.x - view.center.x) / view.metersPerPx,
    y: vp.h / 2 - (p.y - view.center.y) / view.metersPerPx,
  };
}

export function screenToWorld(view: MapView, s: Vec2, vp: Viewport): Vec2 {
  return {
    x: view.center.x + (s.x - vp.w / 2) * view.metersPerPx,
    y: view.center.y - (s.y - vp.h / 2) * view.metersPerPx,
  };
}

/** View that shows the whole rect with at least `paddingPx` of margin on every side. */
export function fitBounds(bounds: Rect, vp: Viewport, paddingPx: number): MapView {
  const availW = Math.max(1, vp.w - 2 * paddingPx);
  const availH = Math.max(1, vp.h - 2 * paddingPx);
  return {
    center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    metersPerPx: Math.max((bounds.maxX - bounds.minX) / availW, (bounds.maxY - bounds.minY) / availH),
  };
}

export function clampZoom(metersPerPx: number, limits: ZoomLimits): number {
  return Math.min(limits.max, Math.max(limits.min, metersPerPx));
}

/**
 * Zoom by `factor` (> 1 zooms in: metersPerPx is divided by it), clamped to `limits`.
 * The world point under `screenPoint` stays under it.
 */
export function zoomAt(view: MapView, screenPoint: Vec2, factor: number, vp: Viewport, limits: ZoomLimits): MapView {
  const metersPerPx = clampZoom(view.metersPerPx / factor, limits);
  const anchor = screenToWorld(view, screenPoint, vp);
  return {
    metersPerPx,
    center: {
      x: anchor.x - (screenPoint.x - vp.w / 2) * metersPerPx,
      y: anchor.y + (screenPoint.y - vp.h / 2) * metersPerPx,
    },
  };
}

/** Drag by (dxPx, dyPx) screen pixels: the content follows the pointer. */
export function pan(view: MapView, dxPx: number, dyPx: number): MapView {
  return {
    metersPerPx: view.metersPerPx,
    center: { x: view.center.x - dxPx * view.metersPerPx, y: view.center.y + dyPx * view.metersPerPx },
  };
}

/** Keeps the view center inside `bounds`, so the map can never be scrolled out of sight. */
export function clampCenter(view: MapView, bounds: Rect): MapView {
  return {
    metersPerPx: view.metersPerPx,
    center: {
      x: Math.min(bounds.maxX, Math.max(bounds.minX, view.center.x)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, view.center.y)),
    },
  };
}

/** Largest 1-2-5 x 10^n length (meters) that is <= maxMeters. */
export function niceScaleLength(maxMeters: number): number {
  if (!(maxMeters > 0)) return 0;
  const pow = 10 ** Math.floor(Math.log10(maxMeters));
  for (const m of [5, 2, 1]) {
    if (m * pow <= maxMeters) return m * pow;
  }
  return pow;
}

/** A label to place: candidate boxes (screen px) in order of preference. */
export interface LabelCandidate {
  /** Higher goes first. Ties keep input order. */
  priority: number;
  boxes: readonly Rect[];
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/**
 * Greedy label placement: by priority, each label takes its first box that stays inside the
 * viewport and overlaps neither a reserved box nor an already placed label.
 * Returns, per candidate (input order), the chosen box index or -1 when it is hidden.
 */
export function placeLabels(candidates: readonly LabelCandidate[], reserved: readonly Rect[], vp: Viewport): number[] {
  const taken: Rect[] = [...reserved];
  const result = candidates.map(() => -1);
  const order = candidates.map((_, i) => i).sort((a, b) => (candidates[b] as LabelCandidate).priority - (candidates[a] as LabelCandidate).priority);
  for (const i of order) {
    const boxes = (candidates[i] as LabelCandidate).boxes;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k] as Rect;
      if (b.minX < 0 || b.minY < 0 || b.maxX > vp.w || b.maxY > vp.h) continue;
      if (taken.some((t) => overlaps(t, b))) continue;
      taken.push(b);
      result[i] = k;
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Map-view LOD (doc 03.12 section 8.5): sharp near the player, softer and coarser with distance.
// Pure; the DOM side (rasters, masks) lives in src/ui/map-base.ts and world-map-canvas.ts.
// ---------------------------------------------------------------------------------------------

export type MapTier = 0 | 1 | 2;

/**
 * Tier table, the single place for the LOD thresholds. `sharpRadiusPx` is the default M0 radius in
 * screen px (the distance is measured in screen px, so the zoom is part of it); `m1Factor` and
 * `m2Factor` multiply the M0 radius to give where M1 and M2 take over (a ramp of 2x the radius from
 * M0 to M1). `metersPerPx` is the baked raster scale; `blurPx` is the blur at the far end of the
 * tier's ramp (screen px at runtime, raster px for the bake of M1 / M2).
 */
export const MAP_TIERS = {
  sharpRadiusPx: 420,
  m1Factor: 3,
  m2Factor: 9,
  m0: { metersPerPx: 1, blurPx: 0 },
  m1: { metersPerPx: 6, blurPx: 1.5 },
  m2: { metersPerPx: 24, blurPx: 4 },
} as const;

/** Proposed cap for all map rasters together (doc 8.5: two M0 + M1 + M2 = about 72 MB, cap 80 MB). */
export const MAP_RASTER_CAP_BYTES = 80_000_000;

/** Bytes of an RGBA raster covering `widthM` x `heightM` at `metersPerPx` (same ceil as pixelFrame). */
export function rasterBytes(widthM: number, heightM: number, metersPerPx: number): number {
  return Math.ceil(widthM / metersPerPx) * Math.ceil(heightM / metersPerPx) * 4;
}

/** Radii (meters) where M0 ends, M1 ends (ramp M0 -> M1 is r0..r1) and M2 is fully in (ramp r1..r2). */
export function mapTierRadiiM(metersPerPx: number, sharpRadiusM?: number): { r0: number; r1: number; r2: number } {
  const r0 = Math.max(0, sharpRadiusM ?? MAP_TIERS.sharpRadiusPx * metersPerPx);
  return { r0, r1: r0 * MAP_TIERS.m1Factor, r2: r0 * MAP_TIERS.m2Factor };
}

/**
 * Tier and blur for a point `distanceM` meters from the player at zoom `metersPerPx`.
 * `sharpRadiusM` defaults to a fixed screen radius at that zoom; the minimap passes its own.
 * `blurPx` (screen px, never negative) grows linearly from 0 at the M0 edge to the M1 blur at the M1
 * edge and on to the M2 blur at the M2 edge, then stays there.
 */
export function mapTierAt(distanceM: number, metersPerPx: number, sharpRadiusM?: number): { tier: MapTier; blurPx: number } {
  const d = Math.abs(distanceM);
  const { r0, r1, r2 } = mapTierRadiiM(metersPerPx, sharpRadiusM);
  const tier: MapTier = d <= r0 ? 0 : d <= r1 ? 1 : 2;
  let blurPx: number;
  if (d <= r0) blurPx = 0;
  else if (d <= r1) blurPx = (MAP_TIERS.m1.blurPx * (d - r0)) / (r1 - r0);
  else if (d <= r2) blurPx = MAP_TIERS.m1.blurPx + ((MAP_TIERS.m2.blurPx - MAP_TIERS.m1.blurPx) * (d - r1)) / (r2 - r1);
  else blurPx = MAP_TIERS.m2.blurPx;
  return { tier, blurPx: Math.max(0, blurPx) };
}
