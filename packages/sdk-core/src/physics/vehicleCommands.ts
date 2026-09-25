import type { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import type { Vehicle } from './vehicle.ts';
import { MAX_GEARS, TORQUE_POINTS, VEHICLE } from './vehicleLayout.ts';
import { wheelsOf } from './vehicleWheels.ts';

/** `values` padded with `fill` to `length`. */
const padded = (values: readonly number[], length: number, fill: number) =>
  Array.from({ length }, (_, i) => values[i] ?? fill);

/** Makes `vehicle` on the body of engine id `body`, under `id` (`vehicleLayout.ts` VEHICLE). */
export function writeVehicle(writer: CommandWriter, id: number, body: number, vehicle: Vehicle) {
  const s = vehicle.spec;
  const { words: wheels, maxSteer } = wheelsOf(vehicle);
  const curve = padded(s.torqueCurve.flat(), TORQUE_POINTS * 2, -1);
  writer.put(
    [OP.vehicle, id, VEHICLE[vehicle.kind], body, vehicle.wheels.length],
    [
      ...[s.torquePerKg, s.idleRPM, s.maxRPM, ...curve, s.shiftUpRPM, s.shiftDownRPM, s.clutch],
      ...[...padded(s.gears, MAX_GEARS, 0), s.reverse, s.finalDrive],
      ...[s.suspensionFrequency, s.suspensionDamping, s.suspensionTravel, s.antiRoll],
      ...[maxSteer, s.steerTime, s.brakeGrip, s.trackTurn, s.maxLean, ...wheels],
    ],
  );
}

/** Takes a vehicle out; its body stays. */
export const writeUnvehicle = (writer: CommandWriter, id: number) =>
  writer.put([OP.unvehicle, id], []);

/** Hands a vehicle its driver's input. */
export function writeDrive(writer: CommandWriter, id: number, { input }: Vehicle) {
  const { throttle, brake, steer, handbrake } = input;
  writer.put([OP.drive, id], [throttle, brake, steer, handbrake ? 1 : 0]);
}
