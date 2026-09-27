import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Vehicle } from '../../../sdk-core/src/physics/index.ts';
import { flatRig, placeVehicle, RELEASED } from './vehicles.fixture.ts';

/** Steps `rig` one step at a time for `steps`: whether each step brought `vehicle` a state. */
function writes(
  t: TestContext,
  rig: Awaited<ReturnType<typeof flatRig>>,
  vehicle: Vehicle,
  steps: number,
) {
  const heard = t.mock.method(vehicle, '_state');
  const out = Array.from({ length: steps }, () => {
    const before = heard.mock.callCount();
    rig.run(1);
    return heard.mock.callCount() > before;
  });
  heard.mock.restore();
  return out;
}

test('a parked vehicle writes its state twice as it rests, then nothing until it moves again', async (t) => {
  const rig = await flatRig();
  const car = placeVehicle(rig, 'car');
  const settle = writes(t, rig, car.vehicle, 600);
  const quiet = settle.lastIndexOf(true) + 1;
  assert.ok(quiet > 0 && quiet < 600, `it comes to rest: last write at step ${quiet}`);
  assert.deepEqual(settle.slice(quiet), Array(600 - quiet).fill(false), 'at rest, nothing written');
  // Driven, it writes every step again; released and at rest, it goes quiet again.
  car.vehicle.drive({ ...RELEASED, throttle: 0.5 });
  assert.ok(writes(t, rig, car.vehicle, 30).every(Boolean), 'driven, every step writes');
  assert.ok(car.vehicle.speed > 0.5, `and the page hears it move: ${car.vehicle.speed} m/s`);
  // Held by the handbrake to a stop, then released: a brake held keeps a vehicle awake.
  car.vehicle.drive({ ...RELEASED, handbrake: true });
  for (let s = 0; s < 1200 && Math.abs(car.vehicle.speed) > 0.01; s += 60)
    assert.ok(writes(t, rig, car.vehicle, 60).every(Boolean), 'braked, awake');
  car.vehicle.drive(RELEASED);
  const stop = writes(t, rig, car.vehicle, 900);
  assert.equal(stop.at(-1), false, 'stopped and released, quiet again');
  assert.ok(
    car.wheels[0].position.toArray().every(Number.isFinite),
    'its wheels kept where they rested',
  );
});

test('a parked vehicle something falls on wakes and writes again', async (t) => {
  const rig = await flatRig();
  const car = placeVehicle(rig, 'car');
  assert.equal(writes(t, rig, car.vehicle, 600).at(-1), false, 'parked');
  const y = rig.at(car.body)[1];
  rig.cube(0, 3, 0);
  const hit = writes(t, rig, car.vehicle, 120);
  assert.ok(hit.some(Boolean), 'the impact wakes it: its state is written again');
  assert.ok(
    Number.isFinite(rig.at(car.body)[1]) && rig.at(car.body)[1] < y + 0.5,
    'still on its wheels',
  );
});
