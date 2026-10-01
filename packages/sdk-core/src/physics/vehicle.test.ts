import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../world/geometry/basic.ts';
import { Material } from '../world/material/material.ts';
import { Mesh } from '../world/object/mesh.ts';
import { Group, type Object3D } from '../world/object/object3d.ts';
import { GRAVITY_PRESETS } from './options.ts';
import { vehicle, Vehicle, type VehicleKind } from './vehicle.ts';
import { MAX_GEARS, TORQUE_POINTS } from './vehicleLayout.ts';
import { VEHICLE_SPECS, type VehicleSpec } from './vehicleSpec.ts';
import { BIKE, FOUR, HULL, rig } from './vehicle.fixture.ts';

test('each kind refuses what it cannot be made of', () => {
  const { body, wheels } = rig(FOUR);
  const make =
    (kind: VehicleKind, list: readonly Object3D[] = wheels, spec = {}) =>
    () =>
      vehicle[kind](body, { wheels: list, ...spec });
  assert.throws(make('motorcycle'), /two wheels/);
  assert.throws(make('car', wheels.slice(0, 2)), /three wheels or more/);
  assert.throws(make('tracked', wheels.slice(0, 3)), /two wheels or more on each side/);
  assert.throws(
    make('car', [...wheels, new Mesh(box(), new Material('meshStandard'))]),
    /children of its body/,
  );
  const hub = new Group();
  body.add(hub);
  assert.throws(make('car', [...wheels, hub]), /no bounds/);
  assert.throws(make('car', wheels, { gears: [3, 2, 1.5, 1.2, 1, 0.8, 0.7] }), /1 to 6 gears/);
  assert.throws(make('car', wheels, { gears: [] }), /1 to 6 gears/);
  assert.throws(make('car', wheels, { torqueCurve: [] }), /torque curve/);
  const tooLong = Array.from({ length: TORQUE_POINTS + 1 }, () => [0, 1] as const);
  assert.throws(make('car', wheels, { torqueCurve: tooLong }), /torque curve/);
  assert.doesNotThrow(make('car'));
  assert.doesNotThrow(make('tracked'));
  // The fewest it takes: three wheels, one gear, one point of torque; as many as the module holds.
  assert.doesNotThrow(make('car', wheels.slice(0, 3), { gears: [1], torqueCurve: [[0, 1]] }));
  assert.doesNotThrow(
    make('car', wheels, {
      gears: Array.from({ length: MAX_GEARS }, (_, i) => MAX_GEARS - i),
      torqueCurve: Array.from({ length: TORQUE_POINTS }, (_, i) => [i / TORQUE_POINTS, 1] as const),
    }),
  );
});

test('a tracked vehicle needs two wheels on each side, wherever they stand along it', () => {
  const hull = rig(HULL);
  assert.doesNotThrow(() => vehicle.tracked(hull.body, hull));
  const offset = rig([
    [-1, -2],
    [-1, 2],
    [0, -1],
    [0, 3],
  ]);
  assert.doesNotThrow(() => vehicle.tracked(offset.body, offset), 'the middle counts right');
  for (const points of [
    [
      [1, -1],
      [1, 1],
      [1, 2],
      [-1, 0],
    ],
    [
      [1, 0],
      [-1, -1],
      [-1, 1],
      [-1, 2],
    ],
  ]) {
    const lopsided = rig(points);
    assert.throws(() => vehicle.tracked(lopsided.body, lopsided), /on each side/);
  }
});

test('the suspension must travel past the sag its ride frequency asks', () => {
  const { body, wheels } = rig(FOUR);
  const make = (spec: Partial<VehicleSpec>) => () => vehicle.car(body, { wheels, ...spec });
  // At 0.8 Hz a spring sags 9.81 / (2π 0.8)² = 0.39 m: 0.2 m of travel would leave the body on
  // its bump stops, 0.45 m holds it.
  assert.throws(make({ suspensionFrequency: 0.8 }), /sag.*0\.388 m/);
  assert.throws(make({ suspensionFrequency: 0 }), /suspensionTravel/);
  assert.doesNotThrow(make({ suspensionFrequency: 0.8, suspensionTravel: 0.45 }));
  // At 1 / 2π Hz the sag is g itself: a travel of exactly g rests on the stops.
  const frequency = 1 / (2 * Math.PI);
  const g = GRAVITY_PRESETS.earth;
  assert.throws(make({ suspensionFrequency: frequency, suspensionTravel: g }), /sag/);
  assert.doesNotThrow(make({ suspensionFrequency: frequency, suspensionTravel: g * 1.001 }));
});

test('each kind refuses an option it would ignore, saying why, and takes it where it is read', () => {
  const rigs = { car: rig(FOUR), motorcycle: rig(BIKE), tracked: rig(HULL) };
  const make = (kind: VehicleKind, option: Partial<VehicleSpec>) => () =>
    vehicle[kind](rigs[kind].body, { wheels: rigs[kind].wheels, ...option });
  const refused = (kind: VehicleKind, option: Partial<VehicleSpec>) => {
    const [name] = Object.keys(option);
    assert.throws(make(kind, option), (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.match(error.message, new RegExp(`^A ${kind}: no ${name}: \\w`), 'and why');
      return true;
    });
  };
  refused('car', { trackTurn: 0.5 });
  refused('car', { maxLean: 0.5 });
  refused('motorcycle', { drive: 'all' });
  refused('motorcycle', { trackTurn: 0.5 });
  refused('motorcycle', { antiRoll: 1 });
  refused('tracked', { clutch: 10 });
  refused('tracked', { drive: 'rear' });
  refused('tracked', { turnRadius: 5 });
  refused('tracked', { antiRoll: 1 });
  refused('tracked', { maxLean: 0.5 });
  // Each taken by the kind that reads it.
  assert.doesNotThrow(make('car', { clutch: 10, drive: 'all', turnRadius: 5, antiRoll: 1 }));
  assert.doesNotThrow(make('motorcycle', { clutch: 2, turnRadius: 5, maxLean: 0.5 }));
  assert.doesNotThrow(make('tracked', { trackTurn: 0.5 }));
});

test('the options go over the kind’s machine; the input is clamped and handed on', () => {
  const { body, wheels } = rig(FOUR);
  const car = vehicle.car(body, { wheels, drive: 'all', turnRadius: 7 });
  assert.ok(car instanceof Vehicle);
  assert.deepEqual([car.kind, car.body, car.wheels], ['car', body, wheels]);
  assert.notEqual(car.wheels, wheels, 'a list of its own');
  assert.deepEqual(car.spec, { ...VEHICLE_SPECS.car, drive: 'all', turnRadius: 7 });
  assert.ok(Object.isFrozen(car.spec));
  let heard = 0;
  car._host = { drive: () => heard++ };
  car.drive({ throttle: 2, brake: -1, steer: -3, handbrake: 1 as unknown as boolean });
  assert.deepEqual(car.input, { throttle: 1, brake: 0, steer: -1, handbrake: true });
  car.drive({ throttle: Number.NaN, brake: 0.5, steer: 3, handbrake: false });
  assert.deepEqual(car.input, { throttle: 0, brake: 0.5, steer: 1, handbrake: false });
  car.drive({ throttle: 0.25, brake: 1, steer: 0.75, handbrake: false });
  assert.deepEqual(car.input, { throttle: 0.25, brake: 1, steer: 0.75, handbrake: false });
  assert.equal(heard, 3);
});

test('a vehicle starts at rest, outside a simulation, and reads what the last step left', () => {
  const bike = rig(BIKE);
  const made = vehicle.motorcycle(bike.body, bike);
  assert.equal(made._id, -1);
  assert.deepEqual(made.input, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  assert.deepEqual([made.speed, made.rpm, made.gear], [0, 0, 0]);
  made.drive({ throttle: 1, brake: 0, steer: 0, handbrake: false });
  made._state(-4, 2500, -1);
  assert.deepEqual([made.speed, made.rpm, made.gear], [-4, 2500, -1]);
});
