import { createServiceKey } from '../ecs/services.ts';
import type { WorldData } from '../world/world-data.ts';
import type { CameraMode, CameraSettings } from '../sim/camera-settings.ts';
import type { Screens } from '../ui/screens.ts';
import type { Layer1Output } from '../world/layers/layer1-land-cover.ts';
import type { Vec2 } from '../world/vec.ts';

/** Shared service keys. Neutral module: plugins import keys from here, never from each other. */
export const WorldDataKey = createServiceKey<WorldData>('world-data');
/** Modal screen stack, menu entries and shortcuts. */
export const ScreensKey = createServiceKey<Screens>('screens');

/** Camera mode, persisted settings and the orbit angles shared by camera, player and minimap. */
export interface CameraControl {
  readonly settings: CameraSettings;
  readonly mode: CameraMode;
  /** True while a third-person mode is active. */
  readonly chase: boolean;
  /** Camera yaw in radians (cameraPose convention); always 0 in top-down mode. */
  yaw: number;
  /** Camera elevation above the ground, degrees (third-person only). */
  pitchDeg: number;
  /**
   * True while the debug free camera is active: the follow camera stands down, Tito and the car stay
   * frozen, and the mouse is captured as in third-person. Owned by the debug-mode plugin.
   */
  free: boolean;
  /** Updates and persists. */
  update(patch: Partial<CameraSettings>): void;
  /** V key: Cenital, 3D cerca, 3D lejos. */
  cycle(): void;
}
export const CameraControlKey = createServiceKey<CameraControl>('camera-control');

/** Layer 1 (land cover), computed once by world-view and shared with the map screens. */
export const LandCoverKey = createServiceKey<Layer1Output>('land-cover');

/** What the debug HUD shows about the free camera (spec metres: x east, y north). */
export interface DebugInfo {
  x: number;
  y: number;
  /** Camera height above sea level, m. */
  height: number;
  /** Terrain height under the camera, m. */
  ground: number;
  /** Land-cover class under the camera. */
  cover: string;
  /** Fly speed, m/s (before Shift). */
  speed: number;
}

/** Debug mode (dev tool): free-fly camera over the whole map. Off by default; `?debug` or F2 turns it on. */
export interface DebugMode {
  readonly active: boolean;
  /** Undefined while debug is off. */
  readonly info: DebugInfo | undefined;
  toggle(): void;
  /** Moves the free camera above a spec point (no-op while debug is off). */
  teleport(spec: Vec2): void;
}
export const DebugModeKey = createServiceKey<DebugMode>('debug-mode');
