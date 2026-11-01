import type { Vec3 } from '../world/coords.ts';

const RAD = Math.PI / 180;

/**
 * Camera pose orbiting `target` in scene space (north = -Z). Yaw 0: the camera sits south
 * (+Z) of the target looking north, so screen-up = north. Pitch is measured from the ground.
 */
export function cameraPose(
  target: Vec3,
  pitchDeg: number,
  distance: number,
  yawDeg: number,
): { position: Vec3; lookAt: Vec3 } {
  const pitch = pitchDeg * RAD;
  const yaw = yawDeg * RAD;
  const horizontal = distance * Math.cos(pitch);
  return {
    position: {
      x: target.x + Math.sin(yaw) * horizontal,
      y: target.y + distance * Math.sin(pitch),
      z: target.z + Math.cos(yaw) * horizontal,
    },
    lookAt: { x: target.x, y: target.y, z: target.z },
  };
}

/** Exponential smoothing, frame-rate independent: the gap halves every `halfLife` seconds. */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(0.5, dt / halfLife);
}
