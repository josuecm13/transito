import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three/webgpu';
import type { RigidBody, Collider } from '@dimforge/rapier3d-compat';
import type { GamePlugin } from '../ecs/plugin.ts';
import type { Entity } from '../ecs/entity.ts';
import { WorldDataKey } from './keys.ts';
import { specToScene } from '../world/coords.ts';
import { findParkingSpot } from '../world/parking.ts';
import { CAR, NO_INPUT, contactSpeed, stepVehicle, vehicleForward } from '../sim/vehicle.ts';
import type { VehicleState } from '../sim/vehicle.ts';
import { yawFacing } from '../sim/locomotion.ts';
import { TITO_BODY, centerY } from '../sim/body.ts';
import { createPrompt } from '../ui/prompt.ts';

/** Car dimensions and interaction numbers, not world data (the speeds live in sim/vehicle.ts). */
const CAR_BODY = {
  length: 4.2,
  width: 1.8,
  /** Collision box: floats above the ground (wheel clearance) so it never touches the 5 km ground cuboid. */
  boxBottom: 0.3,
  boxHeight: 1.0,
  color: 0xd9480f,
  /** Circle pedestrians steer around. */
  obstacleRadius: 2.0,
};
const BOX_CENTER_Y = CAR_BODY.boxBottom + CAR_BODY.boxHeight / 2;
const INTERACT = { doorRadius: 3, exitMaxSpeed: 3, exitSideOffset: 1.7, exitEndOffset: 3.1 };
/** Rotation test shape is a bit smaller than the collider, so the character controller's skin does not block turning. */
const TURN_SHRINK = 0.04;
const TITO_CENTER_Y = centerY(TITO_BODY);

const yawQuat = (yaw: number) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
/** Unit vector to the car's right (+X when yaw = 0). */
const rightOf = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

function buildCarMesh(): { root: Group; frontWheels: Group[] } {
  const root = new Group();
  const paint = new MeshStandardMaterial({ color: CAR_BODY.color, roughness: 0.6 });
  const glass = new MeshStandardMaterial({ color: 0x1b2733, roughness: 0.3 });
  const dark = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
  const lamp = new MeshStandardMaterial({ color: 0xfff4c2, emissive: 0xfff4c2, emissiveIntensity: 0.6 });
  const L = CAR_BODY.length;
  const W = CAR_BODY.width;

  const body = new Mesh(new BoxGeometry(W, 0.55, L), paint);
  body.position.y = 0.3 + 0.275;
  const cabin = new Mesh(new BoxGeometry(W - 0.2, 0.5, L * 0.48), glass);
  cabin.position.set(0, 0.85 + 0.25, L * 0.06);
  const roof = new Mesh(new BoxGeometry(W - 0.2, 0.06, L * 0.46), paint);
  roof.position.set(0, 1.38, L * 0.06);
  root.add(body, cabin, roof);
  for (const x of [-0.6, 0.6]) {
    const l = new Mesh(new BoxGeometry(0.35, 0.16, 0.06), lamp); // nose = -Z
    l.position.set(x, 0.62, -L / 2 - 0.02);
    root.add(l);
  }

  const wheelGeo = new CylinderGeometry(0.34, 0.34, 0.26, 14);
  const frontWheels: Group[] = [];
  for (const sx of [-1, 1]) {
    for (const z of [-L * 0.31, L * 0.31]) {
      const pivot = new Group();
      pivot.position.set(sx * (W / 2 - 0.05), 0.34, z);
      const wheel = new Mesh(wheelGeo, dark);
      wheel.rotation.z = Math.PI / 2;
      pivot.add(wheel);
      root.add(pivot);
      if (z < 0) frontWheels.push(pivot);
    }
  }
  return { root, frontWheels };
}

export const vehicle: GamePlugin = {
  name: 'vehicle',
  dependsOn: ['world-data', 'world-physics', 'player'],
  setup(ctx) {
    const data = ctx.services.get(WorldDataKey);
    const { rapier: R, world } = ctx.physics;

    const spot = findParkingSpot(data.streets.graph, data.buildings, data.slice.spawn.position);
    if (!spot) {
      console.warn('[vehicle] no parking spot near the spawn; no car this run');
      return;
    }
    const p0 = specToScene(spot.position);
    const car = { x: p0.x, z: p0.z };
    let vs: VehicleState = { speed: 0, yaw: yawFacing(spot.heading.x, -spot.heading.y), steer: 0 };

    const halfX = CAR_BODY.width / 2;
    const halfZ = CAR_BODY.length / 2;
    const halfY = CAR_BODY.boxHeight / 2;
    const body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(car.x, BOX_CENTER_Y, car.z).setRotation(yawQuat(vs.yaw)),
    );
    const collider = world.createCollider(R.ColliderDesc.cuboid(halfX, halfY, halfZ), body);
    const turnShape = new R.Cuboid(halfX - TURN_SHRINK, halfY - TURN_SHRINK, halfZ - TURN_SHRINK);
    const titoShape = new R.Capsule(TITO_BODY.halfHeight, TITO_BODY.radius);

    // Same pattern as Tito: shape-cast the box against everything (buildings, walls, pedestrians, Tito).
    const controller = world.createCharacterController(0.05);
    controller.setSlideEnabled(true);

    const { root, frontWheels } = buildCarMesh();
    root.position.set(car.x, 0, car.z);
    root.rotation.y = vs.yaw;
    ctx.view.scene.add(root);

    const entity: Entity = ctx.ecs.add({
      position: { x: car.x, y: 0, z: car.z },
      yaw: vs.yaw,
      vehicle: true,
      obstacle: { radius: CAR_BODY.obstacleRadius },
      body: { handle: body.handle },
      view: { object: root },
    });

    const players = ctx.ecs.with('player');
    const prompt = createPrompt(ctx.ui, { id: 'vehicle-prompt', bottom: '19%' });
    let promptText = '';
    const setPrompt = (text: string): void => {
      if (text === promptText) return;
      promptText = text;
      if (text) prompt.show(text);
      else prompt.hide();
    };

    let driving = false;
    let eWasDown = false;
    let ePressed = false;

    const titoParts = (p: Entity): { body: RigidBody; collider: Collider } | undefined => {
      const b = p.body ? world.getRigidBody(p.body.handle) : undefined;
      return b ? { body: b, collider: b.collider(0) } : undefined;
    };

    /** Driver door (left side, slightly forward) and passenger door, scene space. */
    const doors = (): { x: number; z: number }[] => {
      const f = vehicleForward(vs.yaw);
      const r = rightOf(vs.yaw);
      return [-1, 1].map((s) => ({
        x: car.x + r.x * s * (halfX + 0.1) + f.x * 0.3,
        z: car.z + r.z * s * (halfX + 0.1) + f.z * 0.3,
      }));
    };
    const nearDoor = (p: Entity): boolean =>
      doors().some((d) => Math.hypot(p.position.x - d.x, p.position.z - d.z) <= INTERACT.doorRadius);

    const moveTags = (from: Entity, to: Entity): void => {
      for (const tag of ['cameraTarget', 'populationFocus'] as const) {
        ctx.ecs.removeComponent(from, tag);
        ctx.ecs.addComponent(to, tag, true);
      }
    };

    const enter = (p: Entity): void => {
      const parts = titoParts(p);
      if (!parts) return;
      parts.collider.setEnabled(false);
      const mesh = p.view?.object;
      if (mesh) mesh.visible = false;
      ctx.ecs.addComponent(p, 'inVehicle', true);
      moveTags(p, entity);
      driving = true;
    };

    /** Free spot beside the driver door; falls back to the passenger side, behind, then in front. */
    const freeExitSpot = (): { x: number; z: number } | undefined => {
      const f = vehicleForward(vs.yaw);
      const r = rightOf(vs.yaw);
      const at = (side: number, along: number) => ({
        x: car.x + r.x * side + f.x * along,
        z: car.z + r.z * side + f.z * along,
      });
      const candidates = [
        at(-INTERACT.exitSideOffset, 0.3),
        at(INTERACT.exitSideOffset, 0.3),
        at(0, -INTERACT.exitEndOffset),
        at(0, INTERACT.exitEndOffset),
      ];
      return candidates.find(
        (c) => !world.intersectionWithShape({ x: c.x, y: TITO_CENTER_Y + 0.05, z: c.z }, { x: 0, y: 0, z: 0, w: 1 }, titoShape, undefined, undefined, collider),
      );
    };

    const exit = (p: Entity): void => {
      if (Math.abs(vs.speed) >= INTERACT.exitMaxSpeed) return;
      const parts = titoParts(p);
      const spot2 = freeExitSpot();
      if (!parts || !spot2) return; // boxed in: stay inside
      vs = { ...vs, speed: 0, steer: 0 };
      parts.body.setTranslation({ x: spot2.x, y: TITO_CENTER_Y, z: spot2.z }, true);
      parts.body.setNextKinematicTranslation({ x: spot2.x, y: TITO_CENTER_Y, z: spot2.z });
      parts.collider.setEnabled(true);
      const mesh = p.view?.object;
      if (mesh) mesh.visible = true;
      ctx.ecs.removeComponent(p, 'inVehicle');
      moveTags(entity, p);
      driving = false;
    };

    ctx.addSystem({
      name: 'vehicle-input',
      phase: 'input',
      run(c) {
        const down = c.input.isDown('KeyE');
        if (down && !eWasDown) ePressed = true;
        eWasDown = down;
      },
    });

    ctx.addSystem({
      name: 'vehicle-drive',
      phase: 'fixed',
      run(c, { dt }) {
        const p = players.first;
        if (!p) return;
        if (ePressed) {
          ePressed = false;
          if (driving) exit(p);
          else if (nearDoor(p) && Math.abs(vs.speed) < INTERACT.exitMaxSpeed) enter(p);
        }

        const i = c.input;
        const next = stepVehicle(
          vs,
          driving
            ? {
                throttle: i.isDown('KeyW') || i.isDown('ArrowUp') ? 1 : 0,
                brake: i.isDown('KeyS') || i.isDown('ArrowDown') ? 1 : 0,
                steer: (i.isDown('KeyD') || i.isDown('ArrowRight') ? 1 : 0) - (i.isDown('KeyA') || i.isDown('ArrowLeft') ? 1 : 0),
                handbrake: i.isDown('Space'),
              }
            : NO_INPUT,
          dt,
        );

        let yaw = next.yaw;
        if (yaw !== vs.yaw) {
          // Turning in place would swing the corners into whatever is beside the car: refuse it.
          const hit = world.intersectionWithShape({ x: car.x, y: BOX_CENTER_Y, z: car.z }, yawQuat(yaw), turnShape, undefined, undefined, collider);
          if (hit) yaw = vs.yaw;
        }

        let speed = next.speed;
        if (speed !== 0) {
          const f = vehicleForward(yaw);
          controller.computeColliderMovement(collider, { x: f.x * speed * dt, y: 0, z: f.z * speed * dt });
          const m = controller.computedMovement();
          car.x += m.x;
          car.z += m.z;
          speed = contactSpeed(speed, yaw, m, dt);
        }
        vs = { speed, yaw, steer: next.steer };
        body.setNextKinematicTranslation({ x: car.x, y: BOX_CENTER_Y, z: car.z });
        body.setNextKinematicRotation(yawQuat(yaw));

        if (driving) {
          // Keep Tito's (disabled) body with the car, so player-sync and everything reading `player` follows it.
          titoParts(p)?.body.setTranslation({ x: car.x, y: TITO_CENTER_Y, z: car.z }, true);
        }
      },
    });

    ctx.addSystem({
      name: 'vehicle-sync',
      phase: 'update',
      run() {
        entity.position.x = car.x;
        entity.position.z = car.z;
        entity.yaw = vs.yaw;
        root.position.set(car.x, 0, car.z);
        root.rotation.y = vs.yaw;
        for (const w of frontWheels) w.rotation.y = -vs.steer * 0.45;

        const p = players.first;
        if (p && driving) p.yaw = vs.yaw; // after player-sync: minimap and world-map arrows use the car heading
        if (!p) return;
        if (driving) setPrompt(Math.abs(vs.speed) < INTERACT.exitMaxSpeed ? 'E: bajar' : '');
        else setPrompt(nearDoor(p) ? 'E: subir' : '');
      },
    });
  },
};
