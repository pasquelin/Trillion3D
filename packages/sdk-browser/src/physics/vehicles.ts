import {
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
  writeDrive,
  writeUnvehicle,
  writeVehicle,
  type CommandWriter,
  type Vehicle,
} from '../../../sdk-core/src/physics/index.ts';
import type { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts';
import type { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { createPhysicsBodies } from './bodies.ts';
import { createSimulatedIds, engineIdOf } from './simulatedIds.ts';

/** Each wheel's pose as the page placed it, given back when the vehicle leaves the simulation. */
type Rest = { position: Vector3; quaternion: Quaternion }[];

/**
 * The vehicles of a session: which are made in the simulation, under which id (a slot and its
 * generation). A vehicle is made once its body is simulated, and taken out when the body leaves
 * or is rebuilt, or the vehicle is removed; its wheels are posed from each tick's state.
 */
export function createPhysicsVehicles(
  writer: CommandWriter,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
) {
  /** The engine id of each made vehicle's body, and its wheels at rest. */
  const made = new Map<Vehicle, { body: number; rest: Rest }>();
  const ids = createSimulatedIds<Vehicle>();
  const host: NonNullable<Vehicle['_host']> = {
    drive(vehicle) {
      writeDrive(writer, vehicle._id, vehicle);
      invalidate();
    },
  };
  const drop = (vehicle: Vehicle) => {
    writeUnvehicle(writer, vehicle._id);
    ids.release(vehicle._id);
    made.get(vehicle)!.rest.forEach(({ position, quaternion }, i) => {
      vehicle.wheels[i].position.copy(position);
      vehicle.wheels[i].quaternion.copy(quaternion);
    });
    made.delete(vehicle);
    vehicle._state(0, 0, 0);
    vehicle._host = null;
    vehicle._id = -1;
  };
  const connect = (vehicle: Vehicle) => {
    const body = engineIdOf(bodies, vehicle.body);
    if (body < 0 || vehicle._host) return;
    const id = ids.take(vehicle);
    writeVehicle(writer, id, body, vehicle);
    writeDrive(writer, id, vehicle);
    const rest = vehicle.wheels.map((w) => ({
      position: w.position.clone(),
      quaternion: w.quaternion.clone(),
    }));
    made.set(vehicle, { body, rest });
    vehicle._host = host;
    vehicle._id = id;
  };
  return {
    /** Brings the made vehicles in line with `vehicles` and with the bodies, after the bodies. */
    reconcile(vehicles: ReadonlySet<Vehicle>) {
      for (const [vehicle, { body }] of made)
        if (!vehicles.has(vehicle) || engineIdOf(bodies, vehicle.body) !== body) drop(vehicle);
      for (const vehicle of vehicles) if (!made.has(vehicle)) connect(vehicle);
    },
    /** A tick's vehicle state: speed, engine and gear read, each wheel posed on its body. */
    receive(words: Uint32Array | null) {
      if (!words) return;
      const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
      for (let at = 0; at < words.length;) {
        const vehicle = ids.at(words[at]),
          count = words[at + 1];
        const live = vehicle?._id === words[at] ? vehicle : null;
        live?._state(floats[at + 2], floats[at + 3], floats[at + 4]);
        at += VEHICLE_STATE_WORDS;
        for (let i = 0; live && i < count; i++) {
          const f = floats.subarray(at + i * WHEEL_STATE_WORDS),
            s = live.body.scale;
          const { position, quaternion } = live.wheels[i];
          position.set(f[0] / s.x, f[1] / s.y, f[2] / s.z);
          quaternion.set(f[3], f[4], f[5], f[6]).multiply(made.get(live)!.rest[i].quaternion);
        }
        at += count * WHEEL_STATE_WORDS;
      }
    },
    clear() {
      for (const vehicle of [...made.keys()]) drop(vehicle);
    },
  };
}
