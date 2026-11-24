import type { Rect } from '../world/geometry.ts';
import type { Vec2 } from '../world/vec.ts';
import { sceneToSpec, specToScene } from '../world/coords.ts';
import type { MapView, Viewport } from './map-view.ts';
import { screenToWorld } from './map-view.ts';
import { wrapAngle } from './locomotion.ts';

/**
 * Debug free-fly camera (dev tool). Pure: the plugin feeds input and applies the pose.
 * Poses live in scene space (x east, y up = metres above sea, z = -north). Yaw follows the camera
 * convention of camera-rig / chase-camera: yaw 0 looks north (-Z) and a larger yaw turns the view left.
 * `pitchDown` is radians below the horizon (positive looks down).
 */
export interface FlyPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitchDown: number;
}

export interface FlyInput {
  /** -1..1, W/S relative to the camera yaw. */
  forward: number;
  /** -1..1, D/A. */
  right: number;
  /** -1..1, Space/C. */
  up: number;
}

export const FLY = {
  minSpeed: 10,
  maxSpeed: 2000,
  defaultSpeed: 100,
  /** Speed multiplier per wheel notch (geometric steps). */
  wheelFactor: 1.25,
  boost: 4,
  /** The camera may leave the map by this much (m) on every side. */
  margin: 2000,
  maxHeight: 12000,
  /** Minimum clearance above the terrain (m). */
  clearance: 2,
  maxPitchDeg: 89,
};

/** `?debug` / `?debug=1` enable debug at load; `?debug=0|false|off|no` do not. */
export function parseDebugFlag(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has('debug')) return false;
  const v = (params.get('debug') ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

/** One wheel notch up (negative deltaY) speeds up; clamped to [minSpeed, maxSpeed]. */
export function wheelSpeed(speed: number, notches: number): number {
  const next = speed * FLY.wheelFactor ** notches;
  return Math.min(FLY.maxSpeed, Math.max(FLY.minSpeed, next));
}

/** Mouse look: dx > 0 turns right, dy > 0 looks down (inverted flips dy). Pitch is clamped short of the poles. */
export function lookStep(pose: FlyPose, dx: number, dy: number, radPerPx: number, invertY: boolean): FlyPose {
  const limit = (FLY.maxPitchDeg * Math.PI) / 180;
  const pitchDown = pose.pitchDown + (invertY ? -dy : dy) * radPerPx;
  return {
    ...pose,
    yaw: wrapAngle(pose.yaw - dx * radPerPx),
    pitchDown: Math.min(limit, Math.max(-limit, pitchDown)),
  };
}

/** Unit view direction (scene space). */
export function viewDirection(pose: Pick<FlyPose, 'yaw' | 'pitchDown'>): { x: number; y: number; z: number } {
  const c = Math.cos(pose.pitchDown);
  return { x: -Math.sin(pose.yaw) * c, y: -Math.sin(pose.pitchDown), z: -Math.cos(pose.yaw) * c };
}

/** Yaw and pitch of a view direction (inverse of viewDirection). */
export function anglesOf(dir: { x: number; y: number; z: number }): { yaw: number; pitchDown: number } {
  return { yaw: Math.atan2(-dir.x, -dir.z), pitchDown: Math.asin(Math.max(-1, Math.min(1, -dir.y))) };
}

/** Allowed camera area in spec metres: the map expanded by FLY.margin. */
export function flyBounds(bounds: Rect): Rect {
  return {
    minX: bounds.minX - FLY.margin,
    minY: bounds.minY - FLY.margin,
    maxX: bounds.maxX + FLY.margin,
    maxY: bounds.maxY + FLY.margin,
  };
}

/** Keeps the position inside flyBounds and between terrain + clearance and maxHeight. */
export function clampPose(pose: FlyPose, bounds: Rect, groundAt: (specX: number, specY: number) => number): FlyPose {
  const b = flyBounds(bounds);
  const spec = sceneToSpec(pose);
  const sx = Math.min(b.maxX, Math.max(b.minX, spec.x));
  const sy = Math.min(b.maxY, Math.max(b.minY, spec.y));
  const floor = groundAt(sx, sy) + FLY.clearance;
  const y = Math.min(FLY.maxHeight, Math.max(floor, pose.y));
  const s = specToScene({ x: sx, y: sy }, y);
  return { ...pose, x: s.x, y: s.y, z: s.z };
}

/** Moves the camera: horizontal relative to the yaw, vertical in world Y, then clamps. */
export function flyStep(
  pose: FlyPose,
  input: FlyInput,
  speed: number,
  boosted: boolean,
  dt: number,
  bounds: Rect,
  groundAt: (specX: number, specY: number) => number,
): FlyPose {
  const f = { x: -Math.sin(pose.yaw), z: -Math.cos(pose.yaw) };
  const r = { x: Math.cos(pose.yaw), z: -Math.sin(pose.yaw) };
  const horiz = Math.hypot(input.forward, input.right);
  const norm = horiz > 1 ? 1 / horiz : 1;
  const v = speed * (boosted ? FLY.boost : 1) * dt;
  const moved: FlyPose = {
    ...pose,
    x: pose.x + (f.x * input.forward + r.x * input.right) * norm * v,
    z: pose.z + (f.z * input.forward + r.z * input.right) * norm * v,
    y: pose.y + input.up * v,
  };
  return clampPose(moved, bounds, groundAt);
}

export const OVERVIEW = { pitchDeg: 60, /** Extra room around the map, as a fraction of the frustum. */ slack: 0.1 };

/**
 * Pose above the centre of the map, looking north and down at OVERVIEW.pitchDeg, far enough back
 * that all four corners (at `groundHeight`) sit inside the frustum with some slack.
 * `fovDeg` is the vertical field of view; `aspect` = width / height.
 */
export function overviewPose(bounds: Rect, fovDeg: number, aspect: number, groundHeight = 0): FlyPose {
  const pitchDown = (OVERVIEW.pitchDeg * Math.PI) / 180;
  const tanV = Math.tan((fovDeg * Math.PI) / 360) * (1 - OVERVIEW.slack);
  const tanH = tanV * aspect;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const f = { y: -Math.sin(pitchDown), z: -Math.cos(pitchDown) };
  const u = { y: Math.cos(pitchDown), z: -Math.sin(pitchDown) };
  let back = 0;
  for (const sx of [bounds.minX, bounds.maxX]) {
    for (const sy of [bounds.minY, bounds.maxY]) {
      // Corner relative to the look-at point (centre at ground height), scene axes.
      const o = { x: sx - cx, y: 0, z: -(sy - cy) };
      const depth = o.y * f.y + o.z * f.z;
      back = Math.max(back, Math.abs(o.x) / tanH - depth, Math.abs(o.y * u.y + o.z * u.z) / tanV - depth);
    }
  }
  const target = specToScene({ x: cx, y: cy }, groundHeight);
  return {
    x: target.x,
    y: target.y - f.y * back,
    z: target.z - f.z * back,
    yaw: 0,
    pitchDown,
  };
}

export const TELEPORT = { height: 300, pitchDeg: 45 };

/** Free-camera pose above a spec point, looking north. */
export function teleportPose(spec: Vec2, groundHeight: number): FlyPose {
  const s = specToScene(spec, groundHeight + TELEPORT.height);
  return { x: s.x, y: s.y, z: s.z, yaw: 0, pitchDown: (TELEPORT.pitchDeg * Math.PI) / 180 };
}

/** World-map click (screen px) to a spec point, kept inside the map bounds. */
export function mapClickTarget(view: MapView, screen: Vec2, vp: Viewport, bounds: Rect): Vec2 {
  const p = screenToWorld(view, screen, vp);
  return { x: Math.min(bounds.maxX, Math.max(bounds.minX, p.x)), y: Math.min(bounds.maxY, Math.max(bounds.minY, p.y)) };
}
