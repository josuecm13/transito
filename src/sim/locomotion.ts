import type { Vec3 } from '../world/coords.ts';

export interface LocomotionTuning {
  walk: number;
  run: number;
}

/**
 * Scene-space velocity for a move axis, camera yaw 0 convention:
 * axis.y = screen-up = north = -Z, axis.x = screen-right = +X. Length is clamped to 1 so
 * diagonals are not faster.
 */
export function desiredVelocity(
  axis: { x: number; y: number },
  running: boolean,
  tuning: LocomotionTuning,
): Vec3 {
  const len = Math.hypot(axis.x, axis.y);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  const speed = running ? tuning.run : tuning.walk;
  const k = speed / len;
  return { x: axis.x * k, y: 0, z: -axis.y * k };
}

const TAU = Math.PI * 2;

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** Rotates currentYaw toward targetYaw along the shortest arc, at most maxRadPerSec * dt. */
export function turnTowards(currentYaw: number, targetYaw: number, maxRadPerSec: number, dt: number): number {
  const diff = wrapAngle(targetYaw - currentYaw);
  const step = maxRadPerSec * dt;
  if (Math.abs(diff) <= step) return targetYaw;
  return currentYaw + Math.sign(diff) * step;
}

/** Yaw (rotation about +Y) that makes a model whose nose points to -Z face the given horizontal direction. */
export function yawFacing(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ);
}
