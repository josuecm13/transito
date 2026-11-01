/**
 * Arcade car model (PS2-era feel): no tyre physics, just a signed forward speed and a yaw.
 * Scene space, like `locomotion`: yaw 0 faces -Z (north); a positive yaw turns left (CCW from above).
 * Pure: the plugin integrates the position through Rapier, then feeds the real displacement back
 * through `contactSpeed` so hitting something kills the speed.
 */

export interface VehicleTuning {
  /** Top forward speed, m/s. */
  maxForward: number;
  /** Top reverse speed, m/s. */
  maxReverse: number;
  /** Throttle acceleration, m/s^2. */
  accel: number;
  /** Acceleration in reverse, m/s^2. */
  reverseAccel: number;
  /** Deceleration while braking against the direction of travel, m/s^2. */
  brakeDecel: number;
  /** Extra deceleration with the handbrake, m/s^2. */
  handbrakeDecel: number;
  /** Rolling drag: constant part (m/s^2) and part proportional to speed (1/s). */
  dragConst: number;
  dragLinear: number;
  /** Yaw rate at full steering and full grip speed, rad/s. */
  maxTurnRate: number;
  /** Speed (m/s) at which the turn rate reaches its maximum; below it the rate scales linearly. */
  turnFullSpeed: number;
  /** Fraction of the turn rate lost at top speed (0..1). */
  highSpeedFalloff: number;
  /** Turn-rate multiplier while the handbrake is held (a little drift). */
  handbrakeTurnBoost: number;
  /** How fast the steering wheel follows the input / returns to centre, 1/s. */
  steerRate: number;
  steerReturnRate: number;
}

export const CAR: VehicleTuning = {
  maxForward: 16,
  maxReverse: 5,
  accel: 7,
  reverseAccel: 4,
  brakeDecel: 18,
  handbrakeDecel: 10,
  dragConst: 0.5,
  dragLinear: 0.1,
  maxTurnRate: 1.9,
  turnFullSpeed: 4,
  highSpeedFalloff: 0.5,
  handbrakeTurnBoost: 1.35,
  steerRate: 6,
  steerReturnRate: 9,
};

export interface VehicleState {
  /** Signed speed along the heading, m/s (negative = reversing). */
  speed: number;
  /** Radians. */
  yaw: number;
  /** Steering wheel position, -1 (left) .. 1 (right). */
  steer: number;
}

export interface VehicleInput {
  /** 0..1, W. */
  throttle: number;
  /** 0..1, S: brakes while moving forward, reverses once stopped. */
  brake: number;
  /** -1 (left) .. 1 (right), A/D. */
  steer: number;
  handbrake: boolean;
}

export const NO_INPUT: VehicleInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };

const STOPPED = 0.05;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Unit vector (x, z) the car faces. */
export function vehicleForward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Moves `v` toward 0 by at most `amount`, never past it. */
function toward0(v: number, amount: number): number {
  return v > 0 ? Math.max(0, v - amount) : Math.min(0, v + amount);
}

export function stepVehicle(s: VehicleState, input: VehicleInput, dt: number, t: VehicleTuning = CAR): VehicleState {
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  let v = s.speed;

  if (throttle > 0) {
    v += (v < -STOPPED ? t.brakeDecel : t.accel) * throttle * dt;
    if (s.speed < -STOPPED && v > 0) v = 0; // braking out of a reverse stops first
  }
  if (brake > 0) {
    if (s.speed > STOPPED) v = Math.max(0, v - t.brakeDecel * brake * dt);
    else v -= t.reverseAccel * brake * dt;
  }
  v = toward0(v, (t.dragConst + t.dragLinear * Math.abs(v)) * dt);
  if (input.handbrake) v = toward0(v, t.handbrakeDecel * dt);
  v = clamp(v, -t.maxReverse, t.maxForward);

  const target = clamp(input.steer, -1, 1);
  const rate = Math.abs(target) > Math.abs(s.steer) || Math.sign(target) !== Math.sign(s.steer) ? t.steerRate : t.steerReturnRate;
  const steer = s.steer + clamp(target - s.steer, -rate * dt, rate * dt);

  // Turn rate scales with speed (none at rest) and is inverted in reverse, like a real car.
  const mag = Math.abs(v);
  const grip = Math.min(1, mag / t.turnFullSpeed) * (1 - t.highSpeedFalloff * Math.min(1, mag / t.maxForward));
  const boost = input.handbrake ? t.handbrakeTurnBoost : 1;
  const yaw = s.yaw - steer * t.maxTurnRate * grip * boost * Math.sign(v) * dt;

  return { speed: v, yaw, steer };
}

/**
 * Speed after the physics engine moved the car by `moved` (x, z) during `dt`: the component along
 * the heading, never larger than what was asked, so a wall stops it and a graze only slows it.
 */
export function contactSpeed(speed: number, yaw: number, moved: { x: number; z: number }, dt: number): number {
  const f = vehicleForward(yaw);
  const actual = (moved.x * f.x + moved.z * f.z) / dt;
  return (speed >= 0 ? Math.min(speed, Math.max(0, actual)) : Math.max(speed, Math.min(0, actual))) + 0; // + 0 turns -0 into 0
}
