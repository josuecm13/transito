import { CapsuleGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three/webgpu';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { GamePlugin } from '../ecs/plugin.ts';
import type { Entity } from '../ecs/entity.ts';
import { WorldDataKey } from './keys.ts';
import { sceneToSpec, specToScene } from '../world/coords.ts';
import { createRng } from '../world/rng.ts';
import type { Vec2 } from '../world/vec.ts';
import { distance } from '../world/vec.ts';
import { createSpatialHash } from '../sim/spatial-hash.ts';
import { followerPose, reverseFollower, stepFollower } from '../sim/follower.ts';
import { isBlocked } from '../sim/avoidance.ts';
import { planPopulation } from '../sim/population.ts';
import { PEDESTRIAN_BODY, centerY } from '../sim/body.ts';

/** Game-feel tuning only. Population numbers (budget, rings, speed) come from world.yaml. Body dimensions live in sim/body.ts. */
const PEDS = {
  laneOffset: 0.7,
  lookAhead: 1.4,
  physicalRadius: 50,
  planHz: 4,
  maxSpawnsPerTick: 3,
  giveUpAfter: 4, // s blocked -> turn around
};
/** Physics body is dropped once a pedestrian is this much beyond physicalRadius (hysteresis). */
const PHYSICAL_LEAVE_FACTOR = 1.2;
const HASH_CELL = 4;
/** Muted, clearly not Tito's teal nor the orange/blue/yellow markers. */
const PED_COLORS = [0x8c7b6b, 0x6e7882, 0x8a8a63, 0x7b6585, 0x9a8f86, 0x66756a];

interface PedState {
  index: number;
  speed: number;
  color: number;
  pos: Vec2;
  heading: Vec2;
  blockedFor: number;
  body?: RigidBody;
}

export const pedestrians: GamePlugin = {
  name: 'pedestrians',
  dependsOn: ['world-data', 'world-physics'],
  setup(ctx) {
    const { spec, slice, walkGraph: graph } = ctx.services.get(WorldDataKey);
    const cfg = spec.population.pedestrians;
    const rng = createRng(spec.blockout.seed).fork('pedestrians');
    const { rapier: R, world } = ctx.physics;
    const bodyCenterY = centerY(PEDESTRIAN_BODY);

    const peds = ctx.ecs.with('pedestrian', 'follower');
    const focusQuery = ctx.ecs.with('populationFocus');
    const obstacles = ctx.ecs.with('obstacle');
    const spawnSpec = slice.spawn.position;
    const states = new Map<Entity, PedState>();
    let nextIndex = 0;

    // One instanced mesh for everybody.
    const mesh = new InstancedMesh(
      new CapsuleGeometry(PEDESTRIAN_BODY.radius, PEDESTRIAN_BODY.halfHeight * 2, 4, 8),
      new MeshStandardMaterial({ roughness: 0.9 }),
      cfg.budget,
    );
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.setColorAt(0, new Color(PED_COLORS[0]));
    ctx.view.scene.add(mesh);

    const focusSpec = (): Vec2 => {
      const f = focusQuery.first;
      return f ? sceneToSpec(f.position) : spawnSpec;
    };

    const dropBody = (s: PedState): void => {
      if (!s.body) return;
      world.removeRigidBody(s.body); // also removes its colliders
      s.body = undefined;
    };
    peds.onEntityRemoved.subscribe((e) => {
      const s = states.get(e);
      if (!s) return;
      dropBody(s);
      states.delete(e);
    });

    const place = (e: Entity, s: PedState): void => {
      const pose = followerPose(e.follower as NonNullable<Entity['follower']>, graph, PEDS.laneOffset);
      s.pos = pose.position;
      s.heading = pose.heading;
      const p = specToScene(pose.position, bodyCenterY);
      e.position.x = p.x;
      e.position.y = p.y;
      e.position.z = p.z;
      e.yaw = Math.atan2(pose.heading.y, pose.heading.x);
      s.body?.setNextKinematicTranslation(p);
    };

    const spawnOne = (edge: number, t: number, forward: boolean): void => {
      const speed = rng.range(cfg.speed[0], cfg.speed[1]);
      const color = rng.pick(PED_COLORS);
      const e: Entity = {
        position: { x: 0, y: bodyCenterY, z: 0 },
        yaw: 0,
        pedestrian: { speed },
        follower: { edge, t, forward, blocked: false },
        obstacle: { radius: PEDESTRIAN_BODY.radius },
      };
      states.set(e, { index: nextIndex++, speed, color, pos: spawnSpec, heading: { x: 1, y: 0 }, blockedFor: 0 });
      ctx.ecs.add(e);
      place(e, states.get(e) as PedState);
    };

    const updateLod = (focus: Vec2): void => {
      for (const e of peds) {
        const s = states.get(e);
        if (!s) continue;
        const d = distance(s.pos, focus);
        if (!s.body && d <= PEDS.physicalRadius) {
          const p = e.position;
          s.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z));
          world.createCollider(R.ColliderDesc.capsule(PEDESTRIAN_BODY.halfHeight, PEDESTRIAN_BODY.radius), s.body);
          e.body = { handle: s.body.handle };
        } else if (s.body && d > PEDS.physicalRadius * PHYSICAL_LEAVE_FACTOR) {
          dropBody(s);
          e.body = undefined;
        }
      }
    };

    let planClock = 1 / PEDS.planHz; // plan on the very first update
    ctx.addSystem({
      name: 'pedestrians-plan',
      phase: 'update',
      run(_c, { dt }) {
        planClock += dt;
        if (planClock < 1 / PEDS.planHz) return;
        planClock = 0;
        const focus = focusSpec();
        const agents: { id: number; p: Vec2 }[] = [];
        const byId = new Map<number, Entity>();
        for (const e of peds) {
          const s = states.get(e) as PedState;
          agents.push({ id: s.index, p: s.pos });
          byId.set(s.index, e);
        }
        const plan = planPopulation(
          {
            focus,
            agents,
            budget: cfg.budget,
            spawnRing: cfg.spawnRing,
            despawnAt: cfg.despawnAt,
            maxSpawnsPerTick: PEDS.maxSpawnsPerTick,
          },
          graph,
          rng,
        );
        for (const id of plan.despawn) {
          const e = byId.get(id);
          if (e) ctx.ecs.remove(e);
        }
        for (const s of plan.spawn) spawnOne(s.edge, s.t, s.forward);
        updateLod(focus);
      },
    });

    const hash = createSpatialHash(HASH_CELL);
    type Circle = { p: Vec2; radius: number; owner: Entity };
    ctx.addSystem({
      name: 'pedestrians-walk',
      phase: 'fixed',
      run(_c, { dt }) {
        const circles: Circle[] = [];
        let maxR = PEDESTRIAN_BODY.radius;
        const add = (e: Entity, radius: number): void => {
          circles.push({ p: states.get(e)?.pos ?? sceneToSpec(e.position), radius, owner: e });
          maxR = Math.max(maxR, radius);
        };
        for (const e of obstacles) add(e, (e.obstacle as { radius: number }).radius);
        hash.clear();
        circles.forEach((c, i) => hash.insert(i, c.p));
        const reach = PEDS.lookAhead + PEDESTRIAN_BODY.radius + maxR;

        for (const e of peds) {
          const s = states.get(e) as PedState;
          const f = e.follower as NonNullable<Entity['follower']>;
          const near = hash
            .query(s.pos, reach)
            .map((i) => circles[i] as Circle)
            .filter((c) => c.owner !== e);
          const blocked = isBlocked({ p: s.pos, heading: s.heading, radius: PEDESTRIAN_BODY.radius }, near, PEDS.lookAhead);
          f.blocked = blocked;
          if (blocked) {
            s.blockedFor += dt;
            if (s.blockedFor > PEDS.giveUpAfter) {
              reverseFollower(f);
              s.blockedFor = 0;
              place(e, s);
            }
            continue;
          }
          s.blockedFor = 0;
          stepFollower(f, s.speed * dt, graph, rng);
          place(e, s);
        }
      },
    });

    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const one = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    const col = new Color();
    ctx.addSystem({
      name: 'pedestrians-render',
      phase: 'render',
      run() {
        let i = 0;
        for (const e of peds) {
          const s = states.get(e) as PedState;
          q.setFromAxisAngle(up, e.yaw ?? 0);
          pos.set(e.position.x, e.position.y, e.position.z);
          m.compose(pos, q, one);
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, col.setHex(s.color));
          i++;
        }
        mesh.count = i;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      },
    });
  },
};
