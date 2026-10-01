import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import { vehicle, type Vehicle } from './vehicle.ts';
import { writeDrive, writeUnvehicle, writeVehicle } from './vehicleCommands.ts';
import { MAX_GEARS, TORQUE_POINTS, VEHICLE, WHEEL_ROLE } from './vehicleLayout.ts';
import { DRIVE_WORDS, VEHICLE_WORDS, WHEEL_WORDS } from './wire.fixture.ts';
import { BIKE, FOUR, HULL, rig } from './vehicle.fixture.ts';

/** Each option's spec word after the VEHICLE header, as `vehicles.cpp` reads it (`s + n`). */
const SPEC_WORD = {
  torquePerKg: 0,
  idleRPM: 1,
  maxRPM: 2,
  shiftUpRPM: 13,
  shiftDownRPM: 14,
  clutch: 15,
  reverse: 22,
  finalDrive: 23,
  suspensionFrequency: 24,
  suspensionDamping: 25,
  suspensionTravel: 26,
  antiRoll: 27,
  steerTime: 29,
  brakeGrip: 30,
  trackTurn: 31,
  maxLean: 32,
} as const;
/** Words of the VEHICLE header before the spec: `op, id, kind, body, wheel count`. */
const HEADER = 5;
/** The torque curve's words, then the gears', in the spec: between the words around them. */
const CURVE = [SPEC_WORD.maxRPM + 1, SPEC_WORD.shiftUpRPM] as const;
const GEARS = [SPEC_WORD.clutch + 1, SPEC_WORD.reverse] as const;

const written = (made: Vehicle) => {
  const writer = new CommandWriter();
  writeVehicle(writer, 9, 3, made);
  return writer.take();
};
const specOf = (words: Uint32Array) => new Float32Array(words.buffer).subarray(HEADER);
const near = (n: number) => +n.toFixed(5);

test('VEHICLE carries its header, every option at its own word, then its wheels', () => {
  const { body, wheels } = rig(FOUR);
  // A distinct sentinel in every option: a swapped or shifted word lands another's value.
  const options = Object.fromEntries(Object.keys(SPEC_WORD).map((name, i) => [name, 101 + i]));
  const { trackTurn, maxLean, ...ofCar } = options;
  const torqueCurve = [0.1, 0.2, 0.3, 0.4, 0.5].map((rpm, i) => [rpm, 0.61 + i / 10] as const);
  const gears = [6.1, 5.1, 4.1, 3.1, 2.1, 1.1];
  const words = written(vehicle.car(body, { wheels, ...ofCar, torqueCurve, gears, turnRadius: 5 }));
  const spec = specOf(words);
  assert.equal(words.length, VEHICLE_WORDS + 4 * WHEEL_WORDS);
  assert.deepEqual([...words.subarray(0, HEADER)], [OP.vehicle, 9, VEHICLE.car, 3, 4]);
  for (const [name, value] of Object.entries(ofCar))
    assert.equal(spec[SPEC_WORD[name as keyof typeof SPEC_WORD]], value, `${name} at its word`);
  // The two a car refuses, each on the kind that reads it.
  const bike = rig(BIKE);
  const hull = rig(HULL);
  const tracked = written(vehicle.tracked(hull.body, { ...hull, trackTurn }));
  assert.equal(tracked[2], VEHICLE.tracked);
  assert.equal(specOf(tracked)[SPEC_WORD.trackTurn], trackTurn);
  const motorcycle = written(vehicle.motorcycle(bike.body, { ...bike, maxLean }));
  assert.equal(motorcycle[2], VEHICLE.motorcycle);
  assert.equal(specOf(motorcycle)[SPEC_WORD.maxLean], maxLean);
  assert.deepEqual([...spec.subarray(...CURVE)].map(near), torqueCurve.flat().map(near));
  assert.deepEqual([...spec.subarray(...GEARS)].map(near), gears.map(near));
  // The steered wheels' lock, from the turning radius: a wheelbase of 2.5 m in a 5 m radius.
  assert.equal(near(spec[SPEC_WORD.antiRoll + 1]), near(Math.asin(2.5 / 5)));
  // The first wheel follows the spec: its centre, radius and width, its role.
  const wheel = [...spec.subarray(VEHICLE_WORDS - HEADER, VEHICLE_WORDS - HEADER + WHEEL_WORDS)];
  assert.deepEqual(wheel.map(near), [-0.8, -0.3, -1.25, 0.3, 0.2, WHEEL_ROLE.steers]);
});

test('a short torque curve and gearbox fill the rest of their words with no point and no gear', () => {
  const { body, wheels } = rig(FOUR);
  const spec = specOf(written(vehicle.car(body, { wheels, gears: [1.5], torqueCurve: [[0, 1]] })));
  assert.equal(CURVE[1] - CURVE[0], TORQUE_POINTS * 2);
  assert.equal(GEARS[1] - GEARS[0], MAX_GEARS);
  const noPoint = new Array(TORQUE_POINTS * 2 - 2).fill(-1);
  assert.deepEqual([...spec.subarray(...CURVE)], [0, 1, ...noPoint]);
  assert.deepEqual([...spec.subarray(...GEARS)], [1.5, ...new Array(MAX_GEARS - 1).fill(0)]);
});

test('UNVEHICLE names the vehicle; DRIVE carries the pedals, the wheel and the handbrake', () => {
  const writer = new CommandWriter();
  writeUnvehicle(writer, 7);
  for (const handbrake of [false, true])
    writeDrive(writer, 9, {
      input: { throttle: 0.25, brake: 0.5, steer: -0.75, handbrake },
    } as Vehicle);
  const words = writer.take(),
    floats = new Float32Array(words.buffer);
  assert.equal(words.length, 2 + 2 * DRIVE_WORDS);
  assert.deepEqual([...words.subarray(0, 2)], [OP.unvehicle, 7]);
  for (const [at, handbrake] of [
    [2, 0],
    [2 + DRIVE_WORDS, 1],
  ]) {
    assert.deepEqual([...words.subarray(at, at + 2)], [OP.drive, 9]);
    assert.deepEqual([...floats.subarray(at + 2, at + DRIVE_WORDS)], [0.25, 0.5, -0.75, handbrake]);
  }
});
