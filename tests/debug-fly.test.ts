import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLY,
  anglesOf,
  flyBounds,
  flyStep,
  lookStep,
  mapClickTarget,
  overviewPose,
  parseDebugFlag,
  teleportPose,
  viewDirection,
  wheelSpeed,
  type FlyPose,
} from '../src/sim/debug-fly.ts';
import { sceneToSpec } from '../src/world/coords.ts';

const bounds = { minX: 0, minY: 0, maxX: 6000, maxY: 8000 };
const flat = (): number => 0;
const none = { forward: 0, right: 0, up: 0 };
const at = (p: Partial<FlyPose> = {}): FlyPose => ({ x: 3000, y: 500, z: -4000, yaw: 0, pitchDown: 0.5, ...p });
const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('W at yaw 0 flies north (scene -z); D flies east (+x)', () => {
  const p = flyStep(at(), { ...none, forward: 1 }, 100, false, 1, bounds, flat);
  near(p.x, 3000);
  near(p.z, -4100);
  const e = flyStep(at(), { ...none, right: 1 }, 100, false, 1, bounds, flat);
  near(e.x, 3100);
  near(e.z, -4000);
});

test('movement is relative to the yaw (turned left 90 deg, W flies west) and ignores pitch', () => {
  const p = flyStep(at({ yaw: Math.PI / 2, pitchDown: 1.2 }), { ...none, forward: 1 }, 100, false, 1, bounds, flat);
  near(p.x, 2900);
  near(p.z, -4000);
  near(p.y, 500);
});

test('Shift multiplies speed; diagonals are not faster', () => {
  const fast = flyStep(at(), { ...none, forward: 1 }, 100, true, 1, bounds, flat);
  near(fast.z, -4000 - 100 * FLY.boost);
  const d = flyStep(at(), { forward: 1, right: 1, up: 0 }, 100, false, 1, bounds, flat);
  near(Math.hypot(d.x - 3000, d.z + 4000), 100);
});

test('height never goes below terrain + 2 m or above 12 000 m', () => {
  const hill = (): number => 800;
  const low = flyStep(at({ y: 805 }), { ...none, up: -1 }, 100, true, 10, bounds, hill);
  near(low.y, 802);
  const high = flyStep(at({ y: 11990 }), { ...none, up: 1 }, 100, true, 10, bounds, flat);
  near(high.y, FLY.maxHeight);
});

test('ground height is read at the clamped position', () => {
  // Terrain only high outside the map: flying out must clamp xy, then use the ground at the clamped point.
  const ground = (x: number): number => (x > bounds.maxX + FLY.margin ? 9999 : 0);
  const p = flyStep(at({ x: 7990, y: 10 }), { ...none, right: 1 }, 1000, false, 10, bounds, ground);
  near(p.y, 10);
});

test('xy stays within the bounds expanded by 2 km', () => {
  const b = flyBounds(bounds);
  near(b.minX, -2000);
  near(b.maxY, 10000);
  const east = flyStep(at(), { ...none, right: 1 }, 2000, true, 100, bounds, flat);
  near(sceneToSpec(east).x, 8000);
  const south = flyStep(at(), { ...none, forward: -1 }, 2000, true, 100, bounds, flat);
  near(sceneToSpec(south).y, -2000);
  const north = flyStep(at(), { ...none, forward: 1 }, 2000, true, 100, bounds, flat);
  near(sceneToSpec(north).y, 10000);
});

test('wheel speed steps geometrically and clamps to 10..2000', () => {
  near(wheelSpeed(100, 1), 125);
  near(wheelSpeed(100, -1), 80);
  assert.equal(wheelSpeed(100, 100), FLY.maxSpeed);
  assert.equal(wheelSpeed(100, -100), FLY.minSpeed);
  assert.equal(wheelSpeed(FLY.minSpeed, -1), FLY.minSpeed);
});

test('mouse look turns right with dx > 0, looks down with dy > 0, clamps pitch, invertY flips dy', () => {
  const a = lookStep(at({ yaw: 0, pitchDown: 0 }), 100, 100, 0.01, false);
  assert.ok(a.yaw < 0 && a.pitchDown > 0);
  assert.ok(viewDirection(a).x > 0, 'turning right looks east');
  assert.ok(lookStep(at({ pitchDown: 0 }), 0, 100, 0.01, true).pitchDown < 0);
  near(lookStep(at(), 0, 1e6, 0.01, false).pitchDown, (FLY.maxPitchDeg * Math.PI) / 180);
  const back = anglesOf(viewDirection({ yaw: 0.7, pitchDown: 0.4 }));
  near(back.yaw, 0.7);
  near(back.pitchDown, 0.4);
});

/** True when the point is inside the view frustum of the pose (scene space). */
function visible(pose: FlyPose, p: { x: number; y: number; z: number }, fovDeg: number, aspect: number): boolean {
  const f = viewDirection(pose);
  const r = { x: Math.cos(pose.yaw), y: 0, z: -Math.sin(pose.yaw) };
  const u = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x };
  const o = { x: p.x - pose.x, y: p.y - pose.y, z: p.z - pose.z };
  const depth = o.x * f.x + o.y * f.y + o.z * f.z;
  if (depth <= 0) return false;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const side = Math.abs(o.x * r.x + o.y * r.y + o.z * r.z);
  const vert = Math.abs(o.x * u.x + o.y * u.y + o.z * u.z);
  return side <= tanV * aspect * depth && vert <= tanV * depth;
}

test('overview pose frames all four map corners for several aspects, within height and bounds limits', () => {
  for (const aspect of [1, 4 / 3, 16 / 9, 21 / 9]) {
    const pose = overviewPose(bounds, 50, aspect);
    for (const sx of [bounds.minX, bounds.maxX]) {
      for (const sy of [bounds.minY, bounds.maxY]) {
        assert.ok(visible(pose, { x: sx, y: 0, z: -sy }, 50, aspect), `corner ${sx},${sy} outside frustum at aspect ${aspect}`);
      }
    }
    assert.ok(pose.y <= FLY.maxHeight, `height ${pose.y} above the ceiling at aspect ${aspect}`);
    near(pose.pitchDown, Math.PI / 3);
    near(pose.yaw, 0);
  }
});

test('overview pose looks at the map centre', () => {
  const p = overviewPose(bounds, 50, 16 / 9);
  near(p.x, 3000);
  assert.ok(p.z > -4000, 'camera sits south of the centre looking north');
});

test('teleport pose is 300 m above the point, looking north at 45 deg', () => {
  const p = teleportPose({ x: 1200, y: 3400 }, 80);
  near(p.x, 1200);
  near(p.z, -3400);
  near(p.y, 380);
  near(p.yaw, 0);
  near(p.pitchDown, Math.PI / 4);
});

test('map click converts the screen point and keeps it on the map', () => {
  const view = { center: { x: 3000, y: 4000 }, metersPerPx: 10 };
  const vp = { w: 1000, h: 600 };
  const c = mapClickTarget(view, { x: 500, y: 300 }, vp, bounds);
  near(c.x, 3000);
  near(c.y, 4000);
  const up = mapClickTarget(view, { x: 600, y: 200 }, vp, bounds);
  near(up.x, 4000);
  near(up.y, 5000);
  const out = mapClickTarget(view, { x: -5000, y: 5000 }, vp, bounds);
  assert.deepEqual(out, { x: 0, y: 0 });
});

test('?debug parsing', () => {
  assert.equal(parseDebugFlag(''), false);
  assert.equal(parseDebugFlag('?spawn=x'), false);
  assert.equal(parseDebugFlag('?debug'), true);
  assert.equal(parseDebugFlag('?debug=1'), true);
  assert.equal(parseDebugFlag('?spawn=x&debug'), true);
  assert.equal(parseDebugFlag('?debug=0'), false);
  assert.equal(parseDebugFlag('?debug=false'), false);
});
