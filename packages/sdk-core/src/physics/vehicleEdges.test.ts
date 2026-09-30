import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from '../world/object/mesh.ts';
import { box } from '../world/geometry/basic.ts';
import { Material } from '../world/material/material.ts';
import { Vehicle, type VehicleKind } from './vehicle.ts';
import { wheelsOf } from './vehicleWheels.ts';
import { VEHICLE_SPECS } from './vehicleSpec.ts';

function rig(
  points = [
    [-1, -2],
    [1, -2],
    [-1, 2],
    [1, 2],
  ],
) {
  const body = new Mesh(box(), new Material('meshStandard'));
  const wheels = points.map(([x, z]) => {
    const wheel = new Mesh(box(0.25, 1, 1), body.material);
    wheel.position.set(x, 0, z);
    body.add(wheel);
    return wheel;
  });
  return { body, wheels };
}

test('vehicles expose initial input and every simulated state without requiring a host', () => {
  const { body, wheels } = rig();
  const car = new Vehicle('car', body, { wheels });
  assert.equal(car._id, -1);
  assert.deepEqual(car.input, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  assert.deepEqual([car.speed, car.rpm, car.gear], [0, 0, 0]);
  car._state(-4, 2500, -1);
  assert.deepEqual([car.speed, car.rpm, car.gear], [-4, 2500, -1]);
  car.drive({ throttle: 0.25, brake: 0.5, steer: 0.75, handbrake: false });
  assert.deepEqual(car.input, { throttle: 0.25, brake: 0.5, steer: 0.75, handbrake: false });
});

test('minimum wheel, gear and torque counts are accepted, and empty gears refused', () => {
  const { body, wheels } = rig();
  assert.doesNotThrow(
    () =>
      new Vehicle('car', body, {
        wheels: wheels.slice(0, 3),
        gears: [1],
        torqueCurve: [[0, 1]],
      }),
  );
  assert.throws(() => new Vehicle('car', body, { wheels, gears: [] }), /gears/);
  const tracks = rig([
    [-1, -2],
    [-1, 2],
    [0, -1],
    [0, 3],
  ]);
  assert.doesNotThrow(() => new Vehicle('tracked', tracks.body, tracks));
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
    const invalid = rig(points);
    assert.throws(() => new Vehicle('tracked', invalid.body, invalid), /each side/);
  }
});

test('ignored options explain why they cannot affect their vehicle', () => {
  const reasons: [VehicleKind, string, string][] = [
    ['motorcycle', 'drive', 'its rear wheel drives'],
    ['motorcycle', 'trackTurn', 'it has no tracks'],
    ['motorcycle', 'antiRoll', 'its two wheels are in line'],
    ['tracked', 'clutch', 'its engine drives its tracks'],
    ['tracked', 'drive', 'the rearmost wheel of each track drives'],
    ['tracked', 'turnRadius', 'it has no steered wheels'],
    ['tracked', 'antiRoll', 'its wheels carry no anti-roll bars'],
    ['tracked', 'maxLean', 'it does not lean'],
  ];
  for (const [kind, option, reason] of reasons) {
    const { body, wheels } = rig(
      kind === 'motorcycle'
        ? [
            [0, -1],
            [0, 1],
          ]
        : undefined,
    );
    assert.throws(
      () => new Vehicle(kind, body, { wheels, [option]: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.ok(error.message.includes(reason));
        return true;
      },
    );
  }
});

test('offset axles and asymmetric tracks select roles in the body frame', () => {
  const car = rig([
    [-1, 1],
    [1, 1],
    [-1, 3],
    [1, 3],
    [0, 2],
  ]);
  const result = wheelsOf(new Vehicle('car', car.body, { wheels: car.wheels }));
  assert.deepEqual(
    result.words.filter((_, i) => i % 6 === 5),
    [1, 1, 6, 6, 6],
  );
  assert.ok(Math.abs(Math.sin(result.maxSteer) * 5.5 - 2) < 1e-10);
  const tracks = rig([
    [-1, -2],
    [-1, 1],
    [0, -1],
    [0, 3],
  ]);
  const roles = wheelsOf(new Vehicle('tracked', tracks.body, tracks)).words.filter(
    (_, i) => i % 6 === 5,
  );
  assert.deepEqual(roles, [0, 8, 0, 8]);
  const bike = rig([
    [0, 2],
    [0, 2],
  ]);
  const bikeWords = wheelsOf(new Vehicle('motorcycle', bike.body, bike)).words;
  assert.deepEqual(
    bikeWords.filter((_, i) => i % 6 === 5),
    [6, 6],
  );
});

test('default powertrains retain physically plausible torque, curves and shift ranges', () => {
  const masses = { car: 1470, motorcycle: 319, tracked: 61300 };
  const torqueRanges = { car: [470, 480], motorcycle: [83, 85], tracked: [5080, 5100] };
  for (const kind of ['car', 'motorcycle', 'tracked'] as const) {
    const spec = VEHICLE_SPECS[kind];
    const torque = spec.torquePerKg * masses[kind];
    assert.ok(torque > torqueRanges[kind][0] && torque < torqueRanges[kind][1]);
    assert.ok(spec.shiftUpRPM > 0.8 * spec.maxRPM && spec.shiftUpRPM < spec.maxRPM);
    assert.ok(spec.torqueCurve.length >= 2);
    assert.equal(spec.torqueCurve[0][0], 0);
    assert.equal(spec.torqueCurve.at(-1)![0], 1);
    assert.ok(
      spec.torqueCurve.every(([rpm, torque]) => rpm >= 0 && rpm <= 1 && torque > 0 && torque <= 1),
    );
    assert.ok(spec.torqueCurve.some(([, torque]) => torque === 1));
    for (let i = 1; i < spec.torqueCurve.length; i++)
      assert.ok(spec.torqueCurve[i][0] > spec.torqueCurve[i - 1][0]);
  }
});

test('torque curves cannot exceed the native table and suspension must clear exact static sag', () => {
  const { body, wheels } = rig();
  assert.throws(
    () =>
      new Vehicle('car', body, {
        wheels,
        torqueCurve: Array.from({ length: 6 }, () => [0, 1] as const),
      }),
    /torque curve/,
  );
  const suspensionFrequency = 1 / (2 * Math.PI);
  assert.throws(
    () => new Vehicle('car', body, { wheels, suspensionFrequency, suspensionTravel: 9.81 }),
    /sag/,
  );
  assert.ok(VEHICLE_SPECS.motorcycle.finalDrive > 4 && VEHICLE_SPECS.motorcycle.finalDrive < 5);
  const trike = rig([
    [0, 1],
    [-1, 2],
    [1, 3],
  ]);
  const words = wheelsOf(
    new Vehicle('car', trike.body, { wheels: trike.wheels, drive: 'front' }),
  ).words;
  assert.deepEqual(
    words.filter((_, i) => i % 6 === 5),
    [3, 4, 4],
  );
});
