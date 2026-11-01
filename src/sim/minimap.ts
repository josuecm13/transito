import type { Vec2 } from '../world/vec.ts';

/**
 * Minimap projection: north up, east right. Spec plane (+y north) to minimap pixels (+y down),
 * with `center` landing at (sizePx/2, sizePx/2).
 */
export function worldToMinimap(p: Vec2, center: Vec2, metersPerPx: number, sizePx: number): Vec2 {
  return {
    x: sizePx / 2 + (p.x - center.x) / metersPerPx,
    y: sizePx / 2 - (p.y - center.y) / metersPerPx,
  };
}

/** Pulls a point outside the circle (radius sizePx/2 - marginPx) back onto it, same bearing. */
export function clampToCircle(px: Vec2, sizePx: number, marginPx: number): Vec2 & { clamped: boolean } {
  const c = sizePx / 2;
  const r = c - marginPx;
  const dx = px.x - c;
  const dy = px.y - c;
  const d = Math.hypot(dx, dy);
  if (d <= r) return { x: px.x, y: px.y, clamped: false };
  const k = r / d;
  return { x: c + dx * k, y: c + dy * k, clamped: true };
}

/**
 * Canvas rotation (radians, clockwise-positive) for an arrow drawn pointing up, given the
 * player's scene yaw (rotation about +Y; yaw 0 faces north = -Z, positive yaw turns toward
 * west). Canvas clockwise is toward east, so the angle is the negated yaw.
 */
export function headingToMinimapAngle(yaw: number): number {
  return -yaw;
}
