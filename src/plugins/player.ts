import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from 'three/webgpu';
import type { GamePlugin } from '../ecs/plugin.ts';
import { WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { desiredVelocity, turnTowards, yawFacing } from '../sim/locomotion.ts';
import { TITO_BODY, centerY } from '../sim/body.ts';

/** Game-feel numbers, not world data. Tito's body dimensions live in sim/body.ts. */
const PLAYER = { walk: 4.2, run: 7.5, turnRate: 12 };
const GRAVITY = 9.81;
const MAX_FALL_SPEED = 30;
/** Distance from the feet to the capsule center. */
const CENTER_Y = centerY(TITO_BODY);

export const player: GamePlugin = {
  name: 'player',
  dependsOn: ['world-data', 'world-physics'],
  setup(ctx) {
    const { slice } = ctx.services.get(WorldDataKey);
    const { rapier: R, world } = ctx.physics;

    let start = slice.spawn;
    const wanted = new URLSearchParams(window.location.search).get('spawn');
    if (wanted) {
      const l = slice.landmarks.find((m) => m.id === wanted);
      if (l) start = l;
      else console.warn(`[player] ?spawn="${wanted}" is not a landmark in the active slice; using default spawn`);
    }
    const p0 = specToScene(start.position);

    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(p0.x, p0.y + CENTER_Y, p0.z),
    );
    const collider = world.createCollider(R.ColliderDesc.capsule(TITO_BODY.halfHeight, TITO_BODY.radius), body);

    const controller = world.createCharacterController(0.05);
    controller.setSlideEnabled(true);
    controller.enableAutostep(0.2, 0.1, false);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);

    const mesh = new Group();
    const mat = new MeshStandardMaterial({ color: 0x14b8c4 });
    const capsule = new Mesh(new CapsuleGeometry(TITO_BODY.radius, TITO_BODY.halfHeight * 2, 4, 12), mat);
    capsule.position.y = CENTER_Y;
    const nose = new Mesh(new BoxGeometry(0.2, 0.2, 0.3), new MeshStandardMaterial({ color: 0xffffff }));
    nose.position.set(0, CENTER_Y + 0.35, -TITO_BODY.radius - 0.1);
    mesh.add(capsule, nose);
    mesh.position.set(p0.x, p0.y, p0.z);
    ctx.view.scene.add(mesh);

    const entity = ctx.ecs.add({
      position: { x: p0.x, y: p0.y, z: p0.z },
      yaw: 0,
      player: true,
      populationFocus: true,
      cameraTarget: true,
      obstacle: { radius: TITO_BODY.radius },
      body: { handle: body.handle },
      view: { object: mesh },
    });

    let vy = 0;
    let grounded = false;
    let moveDir: { x: number; z: number } | null = null;

    ctx.addSystem({
      name: 'player-move',
      phase: 'fixed',
      run(c, { dt }) {
        const running = c.input.isDown('ShiftLeft') || c.input.isDown('ShiftRight');
        const v = desiredVelocity(c.input.moveAxis(), running, PLAYER);
        moveDir = v.x !== 0 || v.z !== 0 ? { x: v.x, z: v.z } : null;
        // No gravity while grounded: a downward component on the huge ground cuboid at 5 km
        // coordinates makes Rapier's character controller cancel the horizontal move (f32 precision).
        vy = grounded ? 0 : Math.max(vy - GRAVITY * dt, -MAX_FALL_SPEED);
        controller.computeColliderMovement(collider, { x: v.x * dt, y: vy * dt, z: v.z * dt });
        grounded = controller.computedGrounded();
        const m = controller.computedMovement();
        const t = body.translation();
        body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
      },
    });

    ctx.addSystem({
      name: 'player-sync',
      phase: 'update',
      run(_c, { dt }) {
        const t = body.translation();
        entity.position.x = t.x;
        entity.position.y = t.y - CENTER_Y;
        entity.position.z = t.z;
        if (moveDir) {
          entity.yaw = turnTowards(entity.yaw ?? 0, yawFacing(moveDir.x, moveDir.z), PLAYER.turnRate, dt);
        }
        mesh.position.set(entity.position.x, entity.position.y, entity.position.z);
        mesh.rotation.y = entity.yaw ?? 0;
      },
    });
  },
};
