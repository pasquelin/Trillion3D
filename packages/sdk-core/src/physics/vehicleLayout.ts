/**
 * The vehicles' word layouts, shared with `packages/physics-jolt-wasm/src/vehicles.cpp`; part of
 * `PHYSICS_LAYOUT_VERSION` (`layout.ts`), which a change here bumps.
 */

/** Vehicle kinds of the VEHICLE command, each on Jolt's `VehicleConstraint` and its controller. */
export const VEHICLE = { car: 0, motorcycle: 1, tracked: 2 } as const;
/**
 * Words of VEHICLE before its wheels: `op, vehicle id, kind, engine id, wheel count`, then the
 * spec (`VehicleSpec`): `torque per kg, idle rpm, max rpm`, the torque curve's `TORQUE_POINTS`
 * points (`rpm fraction, torque fraction` each; a fraction below 0 ends it), `shift up rpm, shift
 * down rpm, clutch`, `MAX_GEARS` forward ratios (0 past the last), `reverse, final drive,
 * suspension frequency, suspension damping, suspension travel, anti-roll, max steer angle, steer
 * time, brake grip, track turn, max lean`. Then per wheel `WHEEL_WORDS`: `x, y, z, radius, width,
 * role` — its centre at rest in the body's own frame, and its `WHEEL_ROLE` bits as a float. A
 * vehicle whose body is gone is not made. UNVEHICLE is `op, vehicle id`; DRIVE is `op, vehicle id,
 * throttle, brake, steer, handbrake` (0 or 1).
 */
export const VEHICLE_WORDS = 38;
export const TORQUE_POINTS = 5;
export const MAX_GEARS = 6;
export const WHEEL_WORDS = 6;
export const DRIVE_WORDS = 6;
/** A wheel's role bits: it steers, the engine drives it, the handbrake holds it; on a tracked
 *  vehicle, the track's driven wheel (its sprocket). */
export const WHEEL_ROLE = { steers: 1, driven: 2, handbrake: 4, sprocket: 8 } as const;
/**
 * The vehicles' state after a step (`jolt_vehicles`): per vehicle `id, wheel count, speed (m/s
 * forward), rpm, gear` then per wheel `x, y, z, qx, qy, qz, qw`, its pose in the body's frame.
 */
export const VEHICLE_STATE_WORDS = 5;
export const WHEEL_STATE_WORDS = 7;
