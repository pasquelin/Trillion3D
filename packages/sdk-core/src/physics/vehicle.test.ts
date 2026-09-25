import test from 'node:test';
import assert from 'node:assert/strict';
import { box, cylinder } from '../world/geometry/basic.ts';
import { Material } from '../world/material/material.ts';
import { Mesh } from '../world/object/mesh.ts';
import { Group, type Object3D } from '../world/object/object3d.ts';
import { vehicle, type Vehicle, type VehicleKind } from './vehicle.ts';
import { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import { writeVehicle } from './vehicleCommands.ts';
import { VEHICLE_WORDS, WHEEL_ROLE, WHEEL_WORDS } from './vehicleLayout.ts';
import { VEHICLE_SPECS, type VehicleSpec } from './vehicleSpec.ts';
import { wheelsOf } from './vehicleWheels.ts';

const stuff = () => new Material('meshStandard');
/** A body with a wheel of radius 0.3 and width 0.2 at each `[x, z]`, 0.3 below its centre. */
function rig(at: number[][]) {
  const body = new Mesh(box(2, 0.5, 4), stuff());
  const wheels = at.map(([x, z]) => {
    const wheel = new Mesh(cylinder(0.3, 0.3, 0.2), stuff());
    wheel.position.set(x, -0.3, z);
    wheel.rotation.z = Math.PI / 2;
    body.add(wheel);
    return wheel;
  });
  return { body, wheels };
}
const FOUR = [-1.25, 1.25].flatMap((z) => [-0.8, 0.8].map((x) => [x, z]));
/** A motorcycle's two wheels in line, and a hull's three a side. */
const BIKE = [
  [0, -0.7],
  [0, 0.7],
];
const HULL = [-1, 0, 1].flatMap((z) => [-1, 1].map((x) => [x, z]));
/** Each wheel's role, from the VEHICLE words. */
const roles = (words: number[]) => words.filter((_, i) => i % WHEEL_WORDS === 5);

test('each kind refuses what it cannot be made of', () => {
  const { body, wheels } = rig(FOUR);
  const make =
    (kind: VehicleKind, list: readonly Object3D[] = wheels, spec = {}) =>
    () =>
      vehicle[kind](body, { wheels: list, ...spec });
  assert.throws(make('motorcycle'), /two wheels/);
  assert.throws(make('car', wheels.slice(0, 2)), /three wheels or more/);
  assert.throws(make('tracked', wheels.slice(0, 3)), /two wheels or more on each side/);
  assert.throws(make('car', [...wheels, new Mesh(box(), stuff())]), /children of its body/);
  const hub = new Group();
  body.add(hub);
  assert.throws(make('car', [...wheels, hub]), /no bounds/);
  assert.throws(make('car', wheels, { gears: [3, 2, 1.5, 1.2, 1, 0.8, 0.7] }), /1 to 6 gears/);
  assert.throws(make('car', wheels, { torqueCurve: [] }), /torque curve/);
  assert.doesNotThrow(make('car'));
  assert.doesNotThrow(make('tracked'));
  // At 0.8 Hz a spring sags 9.81 / (2π 0.8)² = 0.39 m: 0.2 m of travel would leave the body on
  // its bump stops, 0.45 m holds it.
  assert.throws(make('car', wheels, { suspensionFrequency: 0.8 }), /sag.*0\.388 m/);
  assert.throws(make('car', wheels, { suspensionFrequency: 0 }), /suspensionTravel/);
  assert.doesNotThrow(make('car', wheels, { suspensionFrequency: 0.8, suspensionTravel: 0.45 }));
});

test('each kind refuses an option it would ignore, and takes it where it is read', () => {
  const rigs = { car: rig(FOUR), motorcycle: rig(BIKE), tracked: rig(HULL) };
  const make = (kind: VehicleKind, option: Partial<VehicleSpec>) => () =>
    vehicle[kind](rigs[kind].body, { wheels: rigs[kind].wheels, ...option });
  assert.throws(make('car', { trackTurn: 0.5 }), /A car: no trackTurn: it has no tracks/);
  assert.throws(make('car', { maxLean: 0.5 }), /A car: no maxLean: it does not lean/);
  assert.throws(make('motorcycle', { drive: 'all' }), /A motorcycle: no drive/);
  assert.throws(make('motorcycle', { trackTurn: 0.5 }), /A motorcycle: no trackTurn/);
  assert.throws(make('motorcycle', { antiRoll: 1 }), /A motorcycle: no antiRoll/);
  assert.throws(make('tracked', { clutch: 10 }), /A tracked: no clutch/);
  assert.throws(make('tracked', { drive: 'rear' }), /A tracked: no drive/);
  assert.throws(make('tracked', { turnRadius: 5 }), /A tracked: no turnRadius/);
  assert.throws(make('tracked', { antiRoll: 1 }), /A tracked: no antiRoll/);
  assert.throws(make('tracked', { maxLean: 0.5 }), /A tracked: no maxLean/);
  // Each taken by the kind that reads it.
  assert.doesNotThrow(make('car', { clutch: 10, drive: 'all', turnRadius: 5, antiRoll: 1 }));
  assert.doesNotThrow(make('motorcycle', { clutch: 2, turnRadius: 5, maxLean: 0.5 }));
  assert.doesNotThrow(make('tracked', { trackTurn: 0.5 }));
});

test('the options go over the kind’s machine; the input is clamped and handed on', () => {
  const { body, wheels } = rig(FOUR);
  const car = vehicle.car(body, { wheels, drive: 'all', turnRadius: 7 });
  assert.equal(car.spec.drive, 'all');
  assert.equal(car.spec.maxRPM, VEHICLE_SPECS.car.maxRPM);
  let heard = 0;
  car._host = { drive: () => heard++ };
  car.drive({ throttle: 2, brake: -1, steer: -3, handbrake: 1 as unknown as boolean });
  assert.deepEqual(car.input, { throttle: 1, brake: 0, steer: -1, handbrake: true });
  assert.equal(heard, 1);
});

test('the gearboxes shift down below where an upshift lands, and up below the redline', () => {
  for (const spec of Object.values(VEHICLE_SPECS)) {
    const steps = spec.gears.slice(1).map((ratio, i) => ratio / spec.gears[i]);
    assert.ok(spec.shiftDownRPM < spec.shiftUpRPM * Math.min(...steps), 'never hunts');
    assert.ok(spec.shiftUpRPM < spec.maxRPM);
  }
});

test('a car’s forward wheels steer, its `drive` wheels drive, the handbrake holds the rear', () => {
  const { body, wheels } = rig(FOUR);
  const rear = wheelsOf(vehicle.car(body, { wheels }));
  const { steers, driven, handbrake } = WHEEL_ROLE;
  assert.deepEqual(roles(rear.words), [steers, steers, handbrake | driven, handbrake | driven]);
  const all = wheelsOf(vehicle.car(body, { wheels, drive: 'all' }));
  assert.deepEqual(roles(all.words), [steers | driven, steers | driven, 6, 6]);
  const front = wheelsOf(vehicle.car(body, { wheels, drive: 'front' }));
  assert.deepEqual(roles(front.words), [steers | driven, steers | driven, handbrake, handbrake]);
  // A wheelbase of 2.5 m in a 5.5 m turning radius.
  assert.equal(rear.maxSteer.toFixed(4), Math.asin(2.5 / 5.5).toFixed(4));
  // Centre, radius and width in the body's frame, its scale applied.
  body.scale.set(2, 2, 2);
  const first = wheelsOf(vehicle.car(body, { wheels })).words.slice(0, 5);
  assert.deepEqual(
    first.map((n) => +n.toFixed(6)),
    [-1.6, -0.6, -2.5, 0.6, 0.4],
  );
});

test('a motorcycle drives its rear wheel; a tracked vehicle its rearmost wheel on each side', () => {
  const bike = rig(BIKE);
  const { steers, driven, handbrake, sprocket } = WHEEL_ROLE;
  assert.deepEqual(roles(wheelsOf(vehicle.motorcycle(bike.body, bike)).words), [
    steers,
    driven | handbrake,
  ]);
  const hull = rig(HULL);
  assert.deepEqual(roles(wheelsOf(vehicle.tracked(hull.body, hull)).words), [
    0,
    0,
    0,
    0,
    sprocket,
    sprocket,
  ]);
});

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

test('VEHICLE carries its header, every option at its own word, then its wheels', () => {
  const { body, wheels } = rig(FOUR);
  // A distinct sentinel in every option: a swapped or shifted word lands another's value.
  const options = Object.fromEntries(Object.keys(SPEC_WORD).map((name, i) => [name, 101 + i]));
  const { trackTurn, maxLean, ...ofCar } = options;
  const torqueCurve = [0.1, 0.2, 0.3, 0.4, 0.5].map((rpm, i) => [rpm, 0.61 + i / 10] as const);
  const gears = [6.1, 5.1, 4.1, 3.1, 2.1, 1.1];
  const written = (made: Vehicle) => {
    const writer = new CommandWriter();
    writeVehicle(writer, 9, 3, made);
    return writer.take();
  };
  const words = written(vehicle.car(body, { wheels, ...ofCar, torqueCurve, gears, turnRadius: 5 }));
  const spec = new Float32Array(words.buffer).subarray(5);
  const near = (n: number) => +n.toFixed(5);
  assert.equal(words.length, VEHICLE_WORDS + 4 * WHEEL_WORDS);
  assert.deepEqual([...words.subarray(0, 5)], [OP.vehicle, 9, 0, 3, 4]);
  for (const [name, value] of Object.entries(ofCar))
    assert.equal(spec[SPEC_WORD[name as keyof typeof SPEC_WORD]], value, `${name} at its word`);
  // The two a car refuses, each on the kind that reads it.
  const bike = rig(BIKE);
  const hull = rig(HULL);
  const specOf = (made: Vehicle) => new Float32Array(written(made).buffer).subarray(5);
  assert.equal(
    specOf(vehicle.tracked(hull.body, { ...hull, trackTurn }))[SPEC_WORD.trackTurn],
    trackTurn,
  );
  assert.equal(
    specOf(vehicle.motorcycle(bike.body, { ...bike, maxLean }))[SPEC_WORD.maxLean],
    maxLean,
  );
  assert.deepEqual([...spec.subarray(3, 13)].map(near), torqueCurve.flat().map(near));
  assert.deepEqual([...spec.subarray(16, 22)].map(near), gears.map(near));
  // The steered wheels' lock, from the turning radius: a wheelbase of 2.5 m in a 5 m radius.
  assert.equal(near(spec[28]), near(Math.asin(2.5 / 5)));
  // The first wheel follows the spec: its centre, radius and width, its role.
  const wheel = [...spec.subarray(VEHICLE_WORDS - 5, VEHICLE_WORDS - 5 + WHEEL_WORDS)];
  assert.deepEqual(wheel.map(near), [-0.8, -0.3, -1.25, 0.3, 0.2, WHEEL_ROLE.steers]);
});
