import { Vector3 } from 'three/webgpu';
import type { GamePlugin } from '../ecs/plugin.ts';
import { CameraControlKey, DebugModeKey, LandCoverKey, ScreensKey, WorldDataKey, type DebugInfo, type DebugMode } from './keys.ts';
import { SENSITIVITY_STEPS } from '../sim/camera-settings.ts';
import {
  FLY,
  anglesOf,
  clampPose,
  flyStep,
  lookStep,
  overviewPose,
  parseDebugFlag,
  teleportPose,
  viewDirection,
  wheelSpeed,
  type FlyPose,
} from '../sim/debug-fly.ts';
import { coverAt } from '../world/layers/layer1-land-cover.ts';
import { sceneToSpec } from '../world/coords.ts';
import type { Vec2 } from '../world/vec.ts';

/** Debug view tuning (dev tool, not world data): see the whole isthmus from the overview pose. */
const DEBUG_VIEW = { near: 2, far: 40000, fogNear: 30000, fogFar: 60000 };

/** Debug mode: free-fly camera over the whole map, Tito and the car frozen. Off by default. */
export const debugMode: GamePlugin = {
  name: 'debug-mode',
  dependsOn: ['screens', 'camera-settings', 'world-data', 'world-view'],
  setup(ctx) {
    const screens = ctx.services.get(ScreensKey);
    const control = ctx.services.get(CameraControlKey);
    const { spec, terrain } = ctx.services.get(WorldDataKey);
    const cover = ctx.services.get(LandCoverKey);
    const bounds = { minX: 0, minY: 0, maxX: spec.bounds.width, maxY: spec.bounds.height };
    const groundAt = (x: number, y: number): number => terrain.heightAt(x, y);
    const camera = ctx.view.camera;
    const scene = ctx.view.scene;

    const badge = document.createElement('div');
    badge.textContent = 'DEBUG';
    badge.style.cssText =
      'position:absolute;top:8px;right:8px;padding:2px 10px;background:#c0392b;color:#fff;' +
      'font:700 14px monospace;letter-spacing:2px;border-radius:3px;pointer-events:none;display:none';
    ctx.ui.append(badge);

    let active = false;
    let info: DebugInfo | undefined;
    let pose: FlyPose | undefined;
    let saved: FlyPose | undefined;
    let speed: number = FLY.defaultSpeed;
    let notches = 0;
    const saveView = { near: camera.near, far: camera.far, fogNear: 0, fogFar: 0 };
    const fogOf = (): { near: number; far: number } | undefined => {
      const f = scene.fog as { near?: number; far?: number } | null;
      return f && typeof f.near === 'number' && typeof f.far === 'number' ? (f as { near: number; far: number }) : undefined;
    };

    const enter = (): void => {
      active = true;
      control.free = true;
      pose = undefined; // read from the camera on the next render step
      saved = undefined;
      notches = 0;
      saveView.near = camera.near;
      saveView.far = camera.far;
      camera.near = DEBUG_VIEW.near;
      camera.far = DEBUG_VIEW.far;
      camera.updateProjectionMatrix();
      const fog = fogOf();
      if (fog) {
        saveView.fogNear = fog.near;
        saveView.fogFar = fog.far;
        fog.near = DEBUG_VIEW.fogNear;
        fog.far = DEBUG_VIEW.fogFar;
      }
      badge.style.display = 'block';
    };
    const leave = (): void => {
      active = false;
      control.free = false; // camera-settings releases the pointer lock when the mode needs none
      info = undefined;
      pose = undefined;
      saved = undefined;
      camera.near = saveView.near;
      camera.far = saveView.far;
      camera.updateProjectionMatrix();
      const fog = fogOf();
      if (fog) {
        fog.near = saveView.fogNear;
        fog.far = saveView.fogFar;
      }
      badge.style.display = 'none';
    };

    const service: DebugMode = {
      get active() {
        return active;
      },
      get info() {
        return info;
      },
      toggle() {
        if (active) leave();
        else enter();
      },
      teleport(at: Vec2) {
        if (!active) return;
        saved = undefined;
        pose = clampPose(teleportPose(at, groundAt(at.x, at.y)), bounds, groundAt);
      },
    };
    ctx.services.provide(DebugModeKey, service);

    const onWheel = (e: WheelEvent): void => {
      if (active && screens.top === undefined) notches -= Math.max(-3, Math.min(3, e.deltaY / 100));
    };
    window.addEventListener('wheel', onWheel, { passive: true });

    let f2Was = false;
    let oWas = false;
    ctx.addSystem({
      name: 'debug-mode-input',
      phase: 'input',
      run(c) {
        const f2 = c.input.isDown('F2');
        if (f2 && !f2Was) service.toggle();
        f2Was = f2;
        const o = c.input.isDown('KeyO');
        if (o && !oWas && active && pose) {
          if (saved) {
            pose = saved;
            saved = undefined;
          } else {
            saved = pose;
            pose = overviewPose(bounds, camera.fov, camera.aspect);
          }
        }
        oWas = o;
      },
    });

    const dir = new Vector3();
    ctx.addSystem({
      name: 'debug-mode-camera',
      phase: 'render',
      run(c, { dt }) {
        if (!active) return;
        if (!pose) {
          camera.getWorldDirection(dir);
          pose = { x: camera.position.x, y: camera.position.y, z: camera.position.z, ...anglesOf(dir) };
        }
        if (!c.pause.paused) {
          const m = c.input.takeMouseDelta();
          if (m.x !== 0 || m.y !== 0) {
            pose = lookStep(pose, m.x, m.y, SENSITIVITY_STEPS[control.settings.sensitivity] ?? 0.003, control.settings.invertY);
          }
          if (notches !== 0) {
            speed = wheelSpeed(speed, notches);
            notches = 0;
          }
          const i = c.input;
          const axis = i.moveAxis();
          pose = flyStep(
            pose,
            { forward: axis.y, right: axis.x, up: (i.isDown('Space') ? 1 : 0) - (i.isDown('KeyC') ? 1 : 0) },
            speed,
            i.isDown('ShiftLeft') || i.isDown('ShiftRight'),
            dt,
            bounds,
            groundAt,
          );
        }
        const d = viewDirection(pose);
        camera.position.set(pose.x, pose.y, pose.z);
        camera.lookAt(pose.x + d.x, pose.y + d.y, pose.z + d.z);
        const at = sceneToSpec(pose);
        info = { x: at.x, y: at.y, height: pose.y, ground: groundAt(at.x, at.y), cover: coverAt(cover, at.x, at.y), speed };
      },
    });

    if (parseDebugFlag(window.location.search)) enter();
  },
};
