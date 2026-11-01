import type { Vec2 } from './vec.ts';

export type Vec3 = { x: number; y: number; z: number };

/**
 * The ONLY spec <-> scene conversion.
 * Spec plane: meters, +x east, +y north, origin SW. Three.js is right-handed, Y-up, so the
 * ground is the XZ plane and north = -Z, east = +X. Height maps to scene Y.
 */
export function specToScene(p: Vec2, height = 0): Vec3 {
  return { x: p.x, y: height, z: -p.y };
}

export function sceneToSpec(v: Vec3): Vec2 {
  return { x: v.x, y: -v.z };
}

/**
 * A counter-clockwise rotation in the spec plane (seen from above, north up) is a rotation of
 * the same angle about +Y in the scene: Three's +Y rotation takes +X toward -Z, i.e. east
 * toward north. So the yaw equals the spec angle.
 */
export function specAngleToSceneYaw(angleRad: number): number {
  return angleRad;
}
