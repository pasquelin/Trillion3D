import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicle } from './vehicle.ts';
import { WHEEL_ROLE } from './vehicleLayout.ts';
import { VEHICLE_SPECS } from './vehicleSpec.ts';
import { wheelsOf } from './vehicleWheels.ts';
import { BIKE, FOUR, HULL, rig, roles } from './vehicle.fixture.ts';

const { steers, driven, handbrake, sprocket } = WHEEL_ROLE;

test('a car’s forward wheels steer, its `drive` wheels drive, the handbrake holds the rear', () => {
  const { body, wheels } = rig(FOUR);
  const rear = wheelsOf(vehicle.car(body, { wheels }));
  assert.deepEqual(roles(rear.words), [steers, steers, handbrake | driven, handbrake | driven]);
  const all = wheelsOf(vehicle.car(body, { wheels, drive: 'all' }));
  assert.deepEqual(roles(all.words), [
    steers | driven,
    steers | driven,
    handbrake | driven,
    handbrake | driven,
  ]);
  const front = wheelsOf(vehicle.car(body, { wheels, drive: 'front' }));
  assert.deepEqual(roles(front.words), [steers | driven, steers | driven, handbrake, handbrake]);
  // Centre, radius and width in the body's frame, its scale applied.
  body.scale.set(2, 2, 2);
  const first = wheelsOf(vehicle.car(body, { wheels })).words.slice(0, 5);
  assert.deepEqual(
    first.map((n) => +n.toFixed(6)),
    [-1.6, -0.6, -2.5, 0.6, 0.4],
  );
});

test('the middle of the wheelbase splits front from rear, wherever the axles stand', () => {
  // Axles at z 1 and 3, and a fifth wheel in the middle: it is a rear one.
  const { body, wheels } = rig([
    [-1, 1],
    [1, 1],
    [-1, 3],
    [1, 3],
    [0, 2],
  ]);
  const car = wheelsOf(vehicle.car(body, { wheels }));
  const back = handbrake | driven;
  assert.deepEqual(roles(car.words), [steers, steers, back, back, back]);
  // A three-wheeler driven at the front: the middle wheel is a rear one, undriven.
  const trike = rig([
    [0, 1],
    [-1, 2],
    [1, 3],
  ]);
  const front = wheelsOf(vehicle.car(trike.body, { wheels: trike.wheels, drive: 'front' }));
  assert.deepEqual(roles(front.words), [steers | driven, handbrake, handbrake]);
});

test('the steered wheels’ lock is the angle the turning radius asks of the wheelbase', () => {
  const { turnRadius } = VEHICLE_SPECS.car;
  for (const wheelbase of [2, 2.5]) {
    const { body, wheels } = rig(FOUR.map(([x, z]) => [x, (Math.sign(z) * wheelbase) / 2]));
    const { maxSteer } = wheelsOf(vehicle.car(body, { wheels }));
    assert.ok(Math.abs(Math.sin(maxSteer) * turnRadius - wheelbase) < 1e-9, `${wheelbase} m`);
  }
  // A wheelbase longer than the radius locks at a right angle.
  const { body, wheels } = rig(FOUR.map(([x, z]) => [x, z * 4]));
  assert.equal(wheelsOf(vehicle.car(body, { wheels, turnRadius: 2 })).maxSteer, Math.PI / 2);
});

test('a motorcycle drives its rear wheel; a tracked vehicle its rearmost wheel on each side', () => {
  const bike = rig(BIKE);
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
  // Tracks of their own lengths: each side's rearmost, the middle wheel on the right.
  const uneven = rig([
    [-1, -2],
    [-1, 1],
    [0, -1],
    [0, 3],
  ]);
  assert.deepEqual(roles(wheelsOf(vehicle.tracked(uneven.body, uneven)).words), [
    0,
    sprocket,
    0,
    sprocket,
  ]);
  // Two wheels at one place: both the front, both the rear; the lock of no wheelbase is none.
  const stacked = rig([
    [0, 2],
    [0, 2],
  ]);
  const both = wheelsOf(vehicle.motorcycle(stacked.body, stacked));
  assert.deepEqual(roles(both.words), [handbrake | driven, handbrake | driven]);
  assert.equal(both.maxSteer, 0);
});
