import type { GamePlugin } from '../ecs/plugin.ts';
import { CameraControlKey, WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { cameraPose, damp } from '../sim/camera-rig.ts';
import { SENSITIVITY_STEPS } from '../sim/camera-settings.ts';
import {
  chasePose,
  chasePreset,
  footRecenterTarget,
  lookBehindYaw,
  occludedDistance,
  orbitStep,
  recenterYaw,
  smoothDistance,
} from '../sim/chase-camera.ts';
import { IGNORE_GROUND_GROUPS } from '../engine/physics.ts';

const CAMERA = {
  pitchDeg: 55,
  distance: 25,
  yawDeg: 0,
  /** Seconds for the followed point to cover half the remaining gap. */
  halfLife: 0.12,
};

/** Third-person tuning (game feel, not world data). */
const CHASE = {
  focusHalfLife: 0.07,
  /** Gap kept between the camera and a wall it was pulled in front of, and the closest it may get (m). */
  wallMargin: 0.4,
  minDistance: 1.2,
  distanceHalfLife: 0.25,
  lookBehindHalfLife: 0.08,
};

export const cameraFollow: GamePlugin = {
  name: 'camera-follow',
  dependsOn: ['world-data', 'world-physics', 'camera-settings'],
  setup(ctx) {
    const { slice, terrain } = ctx.services.get(WorldDataKey);
    const control = ctx.services.get(CameraControlKey);
    const { rapier: R, world } = ctx.physics;
    const targets = ctx.ecs.with('cameraTarget');
    const spawn = specToScene(slice.spawn.position, terrain.heightAt(slice.spawn.position.x, slice.spawn.position.y));
    let focus: { x: number; y: number; z: number } | undefined;
    let wasChase = false;
    let idle = 0;
    let distance = 0;

    ctx.addSystem({
      name: 'camera-follow',
      phase: 'late',
      run(c, { dt }) {
        if (control.free) return; // debug free camera owns the camera and the mouse
        const target = targets.first;
        const t = target?.position ?? spawn;

        if (!control.chase) {
          wasChase = false;
          if (!focus) focus = { x: t.x, y: t.y, z: t.z };
          else {
            focus.x = damp(focus.x, t.x, CAMERA.halfLife, dt);
            focus.y = damp(focus.y, t.y, CAMERA.halfLife, dt);
            focus.z = damp(focus.z, t.z, CAMERA.halfLife, dt);
          }
          const pose = cameraPose(focus, CAMERA.pitchDeg, CAMERA.distance, CAMERA.yawDeg);
          c.view.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
          c.view.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
          return;
        }

        const inCar = target?.vehicle === true;
        const preset = chasePreset(control.mode, inCar);
        if (!wasChase) {
          wasChase = true;
          control.yaw = target?.yaw ?? 0; // start behind the heading
          control.pitchDeg = preset.pitchDeg;
          distance = preset.distance;
          focus = undefined;
        }

        // Mouse orbit; paused frames discard input in the game loop, so this never sees stale movement.
        const m = c.input.takeMouseDelta();
        if (m.x !== 0 || m.y !== 0) {
          idle = 0;
          const o = orbitStep(control.yaw, control.pitchDeg, m.x, m.y, SENSITIVITY_STEPS[control.settings.sensitivity] ?? 0.003, control.settings.invertY);
          control.yaw = o.yaw;
          control.pitchDeg = o.pitchDeg;
        } else idle += dt;

        const heading = target?.yaw ?? control.yaw;
        if (inCar && c.input.isDown('KeyC')) {
          const back = lookBehindYaw(heading);
          control.yaw = recenterYaw(control.yaw, back, 1e9, dt, 0, CHASE.lookBehindHalfLife);
          idle = 0;
        } else {
          const follow = inCar ? heading : footRecenterTarget(c.input.moveAxis(), heading);
          if (follow !== null) control.yaw = recenterYaw(control.yaw, follow, idle, dt);
        }

        const head = { x: t.x, y: t.y + preset.lookHeight, z: t.z };
        if (!focus) focus = head;
        else {
          focus.x = damp(focus.x, head.x, CHASE.focusHalfLife, dt);
          focus.y = damp(focus.y, head.y, CHASE.focusHalfLife, dt);
          focus.z = damp(focus.z, head.z, CHASE.focusHalfLife, dt);
        }

        // Shorten the boom when a building (or wall) sits between the focus and the camera.
        const wanted = chasePose(focus, control.yaw, control.pitchDeg, preset.distance);
        const dx = wanted.position.x - focus.x;
        const dy = wanted.position.y - focus.y;
        const dz = wanted.position.z - focus.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const hit = world.castRay(
          new R.Ray(focus, { x: dx / len, y: dy / len, z: dz / len }),
          preset.distance,
          true,
          R.QueryFilterFlags.EXCLUDE_KINEMATIC,
          IGNORE_GROUND_GROUPS,
        );
        const goal = occludedDistance(preset.distance, hit ? hit.timeOfImpact : null, CHASE.wallMargin, CHASE.minDistance);
        distance = smoothDistance(distance, goal, CHASE.distanceHalfLife, dt);
        const pose = chasePose(focus, control.yaw, control.pitchDeg, Math.min(distance, preset.distance));
        c.view.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        c.view.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
      },
    });
  },
};
