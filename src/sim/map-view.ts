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
