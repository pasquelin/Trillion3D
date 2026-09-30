/**
 * The vehicles' word layouts, shared with `packages/physics-jolt-wasm/src/vehicles.cpp`; part of
 * `PHYSICS_LAYOUT_VERSION` (`layout.ts`), which a change here bumps.
 */

/** Vehicle kinds of the VEHICLE command, each on Jolt's `VehicleConstraint` and its controller. */
export const VEHICLE = { car: 0, motorcycle: 1, tracked: 2 } as const;
export const TORQUE_POINTS = 5;
export const MAX_GEARS = 6;
/** A wheel's role bits: it steers, the engine drives it, the handbrake holds it; on a tracked
 *  vehicle, the track's driven wheel (its sprocket). */
export const WHEEL_ROLE = { steers: 1, driven: 2, handbrake: 4, sprocket: 8 } as const;
/**
 * The vehicles' state after a step (`jolt_vehicles`): per vehicle `id, wheel count, speed (m/s
 * forward), rpm, gear` then per wheel `x, y, z, qx, qy, qz, qw`, its pose in the body's frame.
 * A vehicle at rest is written only as it comes to rest (`vehicles.cpp`).
 */
export const VEHICLE_STATE_WORDS = 5;
export const WHEEL_STATE_WORDS = 7;
