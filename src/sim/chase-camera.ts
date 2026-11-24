import { cameraPose } from './camera-rig.ts';
import { wrapAngle } from './locomotion.ts';
import type { CameraMode } from './camera-settings.ts';
import type { Vec3 } from '../world/coords.ts';

const DEG = Math.PI / 180;

/**
 * Third-person camera yaw convention matches cameraPose: yaw 0 puts the camera south (+Z) of the
 * target looking north. A body whose nose points to -Z with scene yaw `y` has camera-behind yaw `y`.
 */

export interface ChasePreset {
  distance: number;
  pitchDeg: number;
  /** Height above the ground of the point the camera looks at. */
  lookHeight: number;
}

export const CHASE_PRESETS: Record<'near' | 'far', { foot: ChasePreset; car: ChasePreset }> = {
  near: { foot: { distance: 6, pitchDeg: 16, lookHeight: 1.5 }, car: { distance: 9, pitchDeg: 16, lookHeight: 1.3 } },
  far: { foot: { distance: 10, pitchDeg: 20, lookHeight: 1.5 }, car: { distance: 15, pitchDeg: 20, lookHeight: 1.3 } },
};

export function chasePreset(mode: CameraMode, inCar: boolean): ChasePreset {
  const m = mode === 'far' ? 'far' : 'near';
  return inCar ? CHASE_PRESETS[m].car : CHASE_PRESETS[m].foot;
}

export const PITCH_LIMITS = { minDeg: 4, maxDeg: 70 };

/** Camera position and look-at for an orbit around `focus` (yaw radians, pitch from the ground in degrees). */
export function chasePose(focus: Vec3, yawRad: number, pitchDeg: number, distance: number): { position: Vec3; lookAt: Vec3 } {
  return cameraPose(focus, pitchDeg, distance, yawRad / DEG);
}

/**
 * Distance to use when something solid lies `hit` meters from the focus along the camera ray:
 * stop `margin` short of it, never closer than `minDistance`, never farther than `desired`.
 * `hit` null means the ray is clear.
 */
export function occludedDistance(desired: number, hit: number | null, margin: number, minDistance: number): number {
  if (hit === null) return desired;
  return Math.min(desired, Math.max(minDistance, hit - margin));
}

/** Pulls in instantly, eases back out: the camera never clips through a wall for a frame. */
export function smoothDistance(current: number, target: number, halfLife: number, dt: number): number {
  if (target <= current || halfLife <= 0) return target;
  return target + (current - target) * Math.pow(0.5, dt / halfLife);
}

/** Mouse orbit: dx > 0 turns the view right (yaw decreases); dy < 0 looks up (camera lowers) unless inverted. */
export function orbitStep(
  yaw: number,
  pitchDeg: number,
  dx: number,
  dy: number,
  radPerPx: number,
  invertY: boolean,
): { yaw: number; pitchDeg: number } {
  const sign = invertY ? -1 : 1;
  const p = pitchDeg + sign * dy * radPerPx / DEG;
  return {
    yaw: wrapAngle(yaw - dx * radPerPx),
    pitchDeg: Math.min(PITCH_LIMITS.maxDeg, Math.max(PITCH_LIMITS.minDeg, p)),
  };
}

export const RECENTER = { delay: 1.5, halfLife: 0.4 };

/**
 * After `delay` seconds without mouse input, eases the yaw toward `targetYaw` along the shortest
 * arc (350 deg to 10 deg goes through 0, not back through 180).
 */
export function recenterYaw(yaw: number, targetYaw: number, idleSec: number, dt: number, delay = RECENTER.delay, halfLife = RECENTER.halfLife): number {
  if (idleSec < delay) return yaw;
  const diff = wrapAngle(targetYaw - yaw);
  const k = halfLife <= 0 ? 1 : 1 - Math.pow(0.5, dt / halfLife);
  return wrapAngle(yaw + diff * k);
}

/**
 * On foot, the camera only swings back while moving, and not when walking toward the camera
 * (axis.y < 0), which would flip it around forever. Returns the yaw to follow, or null for none.
 */
export function footRecenterTarget(axis: { x: number; y: number }, facingYaw: number): number | null {
  if (Math.hypot(axis.x, axis.y) < 1e-9 || axis.y < 0) return null;
  return facingYaw;
}

/** Camera yaw that looks back over the tail of a body with the given heading (hold C). */
export const lookBehindYaw = (headingYaw: number): number => wrapAngle(headingYaw + Math.PI);
