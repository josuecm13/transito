import type { GamePlugin } from '../ecs/plugin.ts';
import { CameraControlKey, ScreensKey, type CameraControl } from './keys.ts';
import { PAUSE_MENU_ID } from '../ui/screens.ts';
import {
  SETTINGS_KEY,
  isChaseMode,
  nextCameraMode,
  parseSettings,
  serializeSettings,
  type CameraSettings,
} from '../sim/camera-settings.ts';
import { chasePreset } from '../sim/chase-camera.ts';

function load(): CameraSettings {
  try {
    return parseSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return parseSettings(null);
  }
}

function save(s: CameraSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, serializeSettings(s));
  } catch {
    // storage blocked or full: the setting still applies for this session
  }
}

/** Owns the persisted camera settings, the V key and pointer lock (third-person and the debug free camera). */
export const cameraSettings: GamePlugin = {
  name: 'camera-settings',
  dependsOn: ['screens'],
  setup(ctx) {
    const screens = ctx.services.get(ScreensKey);
    const canvas = ctx.view.renderer.domElement as HTMLCanvasElement;
    let settings = load();
    const control: CameraControl = {
      get settings() {
        return settings;
      },
      get mode() {
        return settings.cameraMode;
      },
      get chase() {
        return isChaseMode(settings.cameraMode);
      },
      yaw: 0,
      pitchDeg: chasePreset('near', false).pitchDeg,
      free: false,
      update(patch) {
        settings = { ...settings, ...patch };
        if (!isChaseMode(settings.cameraMode)) control.yaw = 0;
        save(settings);
      },
      cycle() {
        control.update({ cameraMode: nextCameraMode(settings.cameraMode) });
      },
    };
    ctx.services.provide(CameraControlKey, control);

    const locked = (): boolean => document.pointerLockElement !== null;
    const wantsLock = (): boolean => (control.chase || control.free) && screens.top === undefined;

    // A click while playing in third-person captures the mouse (also the click on "Continuar").
    const onClick = (): void => {
      if (wantsLock() && !locked()) void Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
    };
    // The browser eats Esc to leave pointer lock, so a lock lost mid-game opens the pause menu.
    const onLockChange = (): void => {
      if (!locked() && wantsLock()) screens.open(PAUSE_MENU_ID);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLockChange);
    ctx.own(() => document.removeEventListener('click', onClick));
    ctx.own(() => document.removeEventListener('pointerlockchange', onLockChange));

    let vWasDown = false;
    ctx.addSystem({
      name: 'camera-settings-input',
      phase: 'input',
      run(c) {
        const down = c.input.isDown('KeyV');
        if (down && !vWasDown) control.cycle();
        vWasDown = down;
      },
    });

    // Runs while paused too: release the mouse when a screen opens or top-down is selected.
    ctx.addSystem({
      name: 'camera-settings-lock',
      phase: 'render',
      run() {
        if (locked() && (screens.top !== undefined || !(control.chase || control.free))) document.exitPointerLock();
      },
    });
  },
};
