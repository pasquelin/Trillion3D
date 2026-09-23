import { axisAngle, clamp, multiply, normalize, rotate, type Q, type V3 } from '../math3.ts';

/**
 * The arcade flight model: thrust along the nose, drag growing with the square of speed, lift
 * growing with it too and pointing along the wings' up, so a bank turns the aircraft and too
 * little speed stalls it. No aerodynamics beyond that: it is meant to fly well, not to be a
 * simulator. The nose points to the body's local -Z.
 */
export const AIRCRAFT = {
  /** Thrust at full throttle, m/s². */
  thrust: 14,
  /** Top level speed at full throttle, m/s (≈ 430 km/h: the fifty-kilometre map in about seven minutes). */
  topSpeed: 120,
  /** Below this speed the wings no longer carry the weight, m/s. */
  stall: 38,
  gravity: 9.81,
  /** Rates at full control authority, rad/s. */
  pitchRate: 0.9,
  rollRate: 1.6,
  yawRate: 0.35,
  /** Height of the wheels under the body's origin, metres. */
  gear: 1.6,
  /** Damping of vertical drift, 1/s: how fast the path follows the nose. */
  sinkDamping: 1.5,
} as const;

/** Drag coefficient, so full thrust balances drag at the top speed. */
const DRAG = AIRCRAFT.thrust / AIRCRAFT.topSpeed ** 2;

export type Aircraft = {
  position: V3;
  orientation: Q;
  /** Airspeed along the nose, m/s. */
  speed: number;
  /** Vertical drift beside the nose's path, m/s: positive climbs. */
  sink: number;
  throttle: number;
  onGround: boolean;
  stalled: boolean;
};

export type FlightInput = {
  /** Throttle change, −1 to 1 (per second, full range in two seconds). */
  throttle: number;
  /** Nose up positive, −1 to 1. */
  pitch: number;
  /** Right wing down positive, −1 to 1. */
  roll: number;
  /** Nose right positive, −1 to 1. */
  yaw: number;
  brake: boolean;
};

export function aircraft(position: V3, heading: number): Aircraft {
  return {
    position: [...position],
    orientation: axisAngle([0, 1, 0], heading),
    speed: 0,
    sink: 0,
    throttle: 0,
    onGround: true,
    stalled: false,
  };
}

/**
 * Lift the wings could give, as a share of weight: the square of speed over stall speed, capped.
 * Up to the weight it holds the aircraft up; the rest is there to pull it round in a bank.
 */
export const liftRatio = (speed: number) => Math.min(2.5, (speed / AIRCRAFT.stall) ** 2);

/** Advances the aircraft by `dt` seconds over ground of height `ground(x, z)`. */
export function fly(
  plane: Aircraft,
  input: FlightInput,
  dt: number,
  ground: (x: number, z: number) => number,
) {
  const A = AIRCRAFT;
  plane.throttle = clamp(plane.throttle + input.throttle * 0.5 * dt, 0, 1);
  let q = plane.orientation;
  const forward = rotate(q, [0, 0, -1]);
  const up = rotate(q, [0, 1, 0]);
  const rolling = plane.onGround ? 0.25 + (input.brake ? 4 : 0) : 0;
  const along =
    plane.throttle * A.thrust - DRAG * plane.speed ** 2 - A.gravity * forward[1] - rolling;
  plane.speed = Math.max(0, plane.speed + along * dt);
  const lift = A.gravity * liftRatio(plane.speed);
  const support = Math.min(lift, A.gravity);
  plane.stalled = !plane.onGround && plane.speed < A.stall;
  const authority = clamp(plane.speed / A.stall, 0.15, 1);
  // Controls turn the body about its own axes; on the ground the wings stay level and the nose
  // lifts only once the speed allows rotation.
  const pitch = plane.onGround && plane.speed < 0.8 * A.stall ? 0 : input.pitch;
  const roll = plane.onGround ? 0 : input.roll;
  q = multiply(q, axisAngle([1, 0, 0], pitch * A.pitchRate * authority * dt));
  q = multiply(q, axisAngle([0, 0, 1], -roll * A.rollRate * authority * dt));
  q = multiply(
    q,
    axisAngle([0, 1, 0], -input.yaw * A.yawRate * (plane.onGround ? 1.5 : authority) * dt),
  );
  // Lift tilted by a bank pulls the path sideways: the heading turns at that pull over speed.
  const flat = Math.hypot(forward[0], forward[2]) || 1;
  const across = lift * ((up[0] * -forward[2]) / flat + (up[2] * forward[0]) / flat);
  if (!plane.onGround && plane.speed > 1)
    q = multiply(axisAngle([0, 1, 0], (-across / plane.speed) * dt), q);
  // A stalled wing drops the nose.
  if (plane.stalled) q = multiply(q, axisAngle([1, 0, 0], -0.6 * (1 - plane.speed / A.stall) * dt));
  plane.orientation = normalize(q);
  // Above stall speed the path follows the nose; below it the wings cannot hold the weight.
  plane.sink += (support * up[1] - A.gravity - A.sinkDamping * plane.sink) * dt;
  const nose = rotate(plane.orientation, [0, 0, -1]);
  const p = plane.position;
  p[0] += nose[0] * plane.speed * dt;
  p[1] += (nose[1] * plane.speed + plane.sink) * dt;
  p[2] += nose[2] * plane.speed * dt;
  const floor = ground(p[0], p[2]) + A.gear;
  plane.onGround = p[1] <= floor + 0.05;
  if (p[1] < floor) {
    p[1] = floor;
    plane.sink = Math.max(0, plane.sink);
    // Wheels on the ground: the wings settle level and the nose does not dig in.
    const heading = Math.atan2(-nose[0], -nose[2]);
    const lifted = Math.max(0, Math.asin(clamp(nose[1], -1, 1)));
    plane.orientation = multiply(axisAngle([0, 1, 0], heading), axisAngle([1, 0, 0], lifted));
  }
}
