/** Camera mode, persisted player settings and view cycling. Pure: storage is injected by the plugin. */

export type CameraMode = 'topdown' | 'near' | 'far';

/** Order of the V key: Cenital, 3D cerca, 3D lejos, back to Cenital. */
export const CAMERA_CYCLE: readonly CameraMode[] = ['topdown', 'near', 'far'];

export function nextCameraMode(mode: CameraMode): CameraMode {
  const i = CAMERA_CYCLE.indexOf(mode);
  return CAMERA_CYCLE[(i + 1) % CAMERA_CYCLE.length] as CameraMode;
}

export const isChaseMode = (mode: CameraMode): boolean => mode !== 'topdown';

/** Mouse radians per pixel, by sensitivity step (index into this list). */
export const SENSITIVITY_STEPS: readonly number[] = [0.0012, 0.002, 0.003, 0.0045, 0.006];

export interface CameraSettings {
  cameraMode: CameraMode;
  /** Index into SENSITIVITY_STEPS. */
  sensitivity: number;
  invertY: boolean;
}

export const DEFAULT_SETTINGS: CameraSettings = { cameraMode: 'topdown', sensitivity: 2, invertY: false };

/** One versioned key; bump the suffix if the stored shape changes incompatibly. */
export const SETTINGS_KEY = 'transito.settings.v1';
const VERSION = 1;

export function serializeSettings(s: CameraSettings): string {
  return JSON.stringify({ v: VERSION, cameraMode: s.cameraMode, sensitivity: s.sensitivity, invertY: s.invertY });
}

/** Defensive: missing, malformed or wrong-version input gives defaults; bad fields fall back one by one. */
export function parseSettings(raw: string | null | undefined): CameraSettings {
  const out: CameraSettings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'string') return out;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof data !== 'object' || data === null || (data as { v?: unknown }).v !== VERSION) return out;
  const d = data as Record<string, unknown>;
  if (typeof d.cameraMode === 'string' && (CAMERA_CYCLE as readonly string[]).includes(d.cameraMode)) {
    out.cameraMode = d.cameraMode as CameraMode;
  }
  if (typeof d.sensitivity === 'number' && Number.isInteger(d.sensitivity) && d.sensitivity >= 0 && d.sensitivity < SENSITIVITY_STEPS.length) {
    out.sensitivity = d.sensitivity;
  }
  if (typeof d.invertY === 'boolean') out.invertY = d.invertY;
  return out;
}
