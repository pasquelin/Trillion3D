import test from 'node:test';
import assert from 'node:assert/strict';
import { box, cylinder } from '../world/geometry/basic.ts';
import { Material } from '../world/material/material.ts';
import { Mesh } from '../world/object/mesh.ts';
import { Group } from '../world/object/object3d.ts';
import { vehicle, type VehicleKind } from './vehicle.ts';
import { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import { writeVehicle } from './vehicleCommands.ts';
import { VEHICLE_WORDS, WHEEL_ROLE, WHEEL_WORDS } from './vehicleLayout.ts';
import { VEHICLE_SPECS } from './vehicleSpec.ts';
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
/** Each wheel's role, from the VEHICLE words. */
const roles = (words: number[]) => words.filter((_, i) => i % WHEEL_WORDS === 5);

test('each kind refuses what it cannot be made of', () => {
  const { body, wheels } = rig(FOUR);
  const make =
    (kind: VehicleKind, list = wheels, spec = {}) =>
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
  const bike = rig([
    [0, -0.7],
    [0, 0.7],
  ]);
  const { steers, driven, handbrake, sprocket } = WHEEL_ROLE;
  assert.deepEqual(roles(wheelsOf(vehicle.motorcycle(bike.body, bike)).words), [
    steers,
    driven | handbrake,
  ]);
  const hull = rig([-1, 0, 1].flatMap((z) => [-1, 1].map((x) => [x, z])));
  assert.deepEqual(roles(wheelsOf(vehicle.tracked(hull.body, hull)).words), [
    0,
    0,
    0,
    0,
    sprocket,
    sprocket,
  ]);
});

test('VEHICLE carries its header, the spec, then its wheels, at their layout offsets', () => {
  const { body, wheels } = rig(FOUR);
  const writer = new CommandWriter();
  writeVehicle(writer, 9, 3, vehicle.car(body, { wheels, idleRPM: 800 }));
  const words = writer.take(),
    floats = new Float32Array(words.buffer);
  assert.equal(words.length, VEHICLE_WORDS + 4 * WHEEL_WORDS);
  assert.deepEqual([...words.subarray(0, 5)], [OP.vehicle, 9, 0, 3, 4]);
  assert.equal(floats[6], 800, 'the options over the machine');
  // The first wheel follows the spec: its centre, radius and width, its role.
  const wheel = [...floats.subarray(VEHICLE_WORDS, VEHICLE_WORDS + WHEEL_WORDS)];
  assert.deepEqual(
    wheel.map((n) => +n.toFixed(5)),
    [-0.8, -0.3, -1.25, 0.3, 0.2, WHEEL_ROLE.steers],
  );
});
