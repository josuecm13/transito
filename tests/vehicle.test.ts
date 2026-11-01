import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAR, NO_INPUT, contactSpeed, stepVehicle, vehicleForward } from '../src/sim/vehicle.ts';
import type { VehicleInput, VehicleState } from '../src/sim/vehicle.ts';

const DT = 1 / 60;
const REST: VehicleState = { speed: 0, yaw: 0, steer: 0 };
const inp = (p: Partial<VehicleInput>): VehicleInput => ({ ...NO_INPUT, ...p });
function run(s: VehicleState, i: VehicleInput, seconds: number): VehicleState {
  let cur = s;
  for (let k = 0; k < Math.round(seconds / DT); k++) cur = stepVehicle(cur, i, DT);
  return cur;
}

test('throttle accelerates forward and tops out near maxForward (~16 m/s)', () => {
  const s = run(REST, inp({ throttle: 1 }), 10);
  assert.ok(s.speed > 15.9 && s.speed <= CAR.maxForward, `speed ${s.speed}`);
  assert.ok(run(REST, inp({ throttle: 1 }), 1).speed > 3, 'pulls away briskly');
});

test('holding brake from rest reverses, capped at maxReverse (~5 m/s)', () => {
  const s = run(REST, inp({ brake: 1 }), 10);
  assert.ok(s.speed < -4.9 && s.speed >= -CAR.maxReverse, `speed ${s.speed}`);
});

test('braking while moving forward stops first, it does not flip into reverse in one step', () => {
  const fast: VehicleState = { speed: 10, yaw: 0, steer: 0 };
  const one = stepVehicle(fast, inp({ brake: 1 }), DT);
  assert.ok(one.speed < 10 && one.speed > 9, `one step ${one.speed}`);
  const slowed = run(fast, inp({ brake: 1 }), 0.5);
  assert.ok(slowed.speed >= 0 && slowed.speed < 2, `after 0.5 s ${slowed.speed}`);
  const near0 = stepVehicle({ speed: 0.1, yaw: 0, steer: 0 }, inp({ brake: 1 }), 1);
  assert.equal(near0.speed, 0, 'a big step from 0.1 m/s clamps at 0, no overshoot into reverse');
});

test('throttle while reversing brakes first', () => {
  const s = stepVehicle({ speed: -4, yaw: 0, steer: 0 }, inp({ throttle: 1 }), DT);
  assert.ok(s.speed > -4 + CAR.accel * DT, `braked harder than plain accel: ${s.speed}`);
});

test('rolling drag slows a coasting car to a stop and never reverses it', () => {
  const s1 = run({ speed: 16, yaw: 0, steer: 0 }, NO_INPUT, 2);
  assert.ok(s1.speed < 16 && s1.speed > 10, `2 s coast ${s1.speed}`);
  const s2 = run({ speed: 16, yaw: 0, steer: 0 }, NO_INPUT, 60);
  assert.equal(s2.speed, 0);
  const s3 = run({ speed: -5, yaw: 0, steer: 0 }, NO_INPUT, 60);
  assert.equal(s3.speed, 0);
});

test('handbrake stops the car faster than coasting', () => {
  const start: VehicleState = { speed: 12, yaw: 0, steer: 0 };
  assert.ok(run(start, inp({ handbrake: true }), 1).speed < run(start, NO_INPUT, 1).speed - 5);
});

test('no turning at rest, even at full steering lock', () => {
  const s = run(REST, inp({ steer: 1 }), 2);
  assert.equal(s.yaw, 0);
  assert.ok(s.steer > 0.99, 'the wheel itself still turns');
});

test('steering right turns clockwise from above (yaw decreases), left the opposite', () => {
  const start: VehicleState = { speed: 8, yaw: 0, steer: 0 };
  assert.ok(run(start, inp({ steer: 1 }), 0.5).yaw < -0.1);
  assert.ok(run(start, inp({ steer: -1 }), 0.5).yaw > 0.1);
});

test('turn rate scales with speed', () => {
  const at = (speed: number): number => Math.abs(run({ speed, yaw: 0, steer: 1 }, inp({ steer: 1 }), 0.1).yaw);
  assert.ok(at(1) < at(3) * 0.6, `1 m/s ${at(1)} vs 3 m/s ${at(3)}`);
  assert.ok(at(4) > 0);
  assert.ok(at(16) < at(4), 'grip falls off a little at top speed');
});

test('steering is inverted in reverse', () => {
  const fwd = run({ speed: 4, yaw: 0, steer: 0 }, inp({ steer: 1 }), 0.3).yaw;
  const back = run({ speed: -4, yaw: 0, steer: 0 }, inp({ steer: 1 }), 0.3).yaw;
  assert.ok(fwd < 0 && back > 0, `fwd ${fwd}, back ${back}`);
});

test('steering wheel eases toward the input and back to centre', () => {
  const one = stepVehicle(REST, inp({ steer: 1 }), DT);
  assert.ok(one.steer > 0 && one.steer < 0.5, `one step ${one.steer}`);
  assert.ok(run({ speed: 0, yaw: 0, steer: 1 }, NO_INPUT, 1).steer === 0);
});

test('vehicleForward: yaw 0 faces -z, yaw +90deg faces -x', () => {
  const a = vehicleForward(0);
  assert.ok(Math.abs(a.x) < 1e-12 && Math.abs(a.z + 1) < 1e-12);
  const b = vehicleForward(Math.PI / 2);
  assert.ok(Math.abs(b.x + 1) < 1e-12 && Math.abs(b.z) < 1e-12);
});

test('contactSpeed: free movement keeps the speed, a wall kills it, a graze slows it', () => {
  const f = vehicleForward(0.7);
  const dt = DT;
  const free = { x: f.x * 10 * dt, z: f.z * 10 * dt };
  assert.ok(Math.abs(contactSpeed(10, 0.7, free, dt) - 10) < 1e-9);
  assert.equal(contactSpeed(10, 0.7, { x: 0, z: 0 }, dt), 0);
  const slid = contactSpeed(10, 0.7, { x: free.x * 0.3, z: free.z * 0.3 }, dt);
  assert.ok(Math.abs(slid - 3) < 1e-9, `slid ${slid}`);
  assert.equal(contactSpeed(-5, 0.7, { x: 0, z: 0 }, dt), 0);
  const back = contactSpeed(-5, 0.7, { x: -f.x * 5 * dt, z: -f.z * 5 * dt }, dt);
  assert.ok(Math.abs(back + 5) < 1e-9);
  assert.equal(contactSpeed(5, 0.7, { x: -f.x * dt, z: -f.z * dt }, dt), 0, 'pushed backwards never gives negative speed');
});
