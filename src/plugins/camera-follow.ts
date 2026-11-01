import type { GamePlugin } from '../ecs/plugin.ts';
import { WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { cameraPose, damp } from '../sim/camera-rig.ts';

const CAMERA = {
  pitchDeg: 55,
  distance: 25,
  yawDeg: 0,
  /** Seconds for the followed point to cover half the remaining gap. */
  halfLife: 0.12,
};

export const cameraFollow: GamePlugin = {
  name: 'camera-follow',
  dependsOn: ['world-data'],
  setup(ctx) {
    const { slice } = ctx.services.get(WorldDataKey);
    const targets = ctx.ecs.with('cameraTarget');
    const spawn = specToScene(slice.spawn.position);
    let focus: { x: number; y: number; z: number } | undefined;

    ctx.addSystem({
      name: 'camera-follow',
      phase: 'late',
      run(c, { dt }) {
        const t = targets.first?.position ?? spawn;
        if (!focus) focus = { x: t.x, y: t.y, z: t.z };
        else {
          focus.x = damp(focus.x, t.x, CAMERA.halfLife, dt);
          focus.y = damp(focus.y, t.y, CAMERA.halfLife, dt);
          focus.z = damp(focus.z, t.z, CAMERA.halfLife, dt);
        }
        const pose = cameraPose(focus, CAMERA.pitchDeg, CAMERA.distance, CAMERA.yawDeg);
        c.view.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        c.view.camera.lookAt(pose.lookAt.x, pose.lookAt.y, pose.lookAt.z);
      },
    });
  },
};
