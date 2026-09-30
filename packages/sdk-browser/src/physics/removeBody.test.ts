import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CommandWriter,
  FLAG,
  OP,
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
  writeVehicle,
} from '../../../sdk-core/src/physics/index.ts';
import { vehicle } from '../../../sdk-core/src/physics/vehicle.ts';
import { box, cylinder } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { events, startModule, type Module } from './module.fixture.ts';
import { body } from './records.fixture.ts';

/** A car whose four wheels sit inside its body's box: the box itself rests on the floor. */
function car() {
  const hull = new Mesh(box(2, 2, 2), new Material('meshStandard'));
  const wheels = [-0.6, 0.6].flatMap((z) =>
    [-0.6, 0.6].map((x) => {
      const wheel = new Mesh(cylinder(0.3, 0.3, 0.2), new Material('meshStandard'));
      wheel.position.set(x, -0.3, z);
      wheel.rotation.z = Math.PI / 2;
      hull.add(wheel);
      return wheel;
    }),
  );
  return vehicle.car(hull, { wheels });
}

/** The vehicle ids in the module's last vehicle state (`vehicleLayout.ts`). */
function vehicleIds(jolt: Module) {
  const words = jolt.vehicles(),
    ids: number[] = [];
  for (let at = 0; at < words.length; at += VEHICLE_STATE_WORDS + words[at + 1] * WHEEL_STATE_WORDS)
    ids.push(words[at]);
  return ids;
}

test('REMOVE takes out the vehicle on the body and leaves every pair it was in, and only those', async () => {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(0, 0, -50, 50), position: [0, -50, 0] });
  // Two cars on the floor, a cube on each roof, all asking for events.
  for (const [n, x] of [0, 10].entries()) {
    writer.add({ ...body(1 + n, 2, 0, 1, FLAG.events), position: [x, 1, 0] });
    writer.add({ ...body(3 + n, 2, 0, 0.25, FLAG.events), position: [x, 2.25, 0] });
    writeVehicle(writer, n, 1 + n, car());
  }
  // Handbrakes on: the cars stay awake, so both write their state every step.
  const hold = () => [0, 1].forEach((n) => writer.put([OP.drive, n], [0, 0, 0, 1]));
  const open = new Set<string>();
  const step = () => {
    hold();
    jolt.step(writer.take(), 1 / 60);
    const heard = events(jolt);
    for (const [type, a, b] of heard) {
      const key = [a, b].sort((p, q) => p - q).join('-');
      if (type === 1) open.add(key);
      if (type === 2) open.delete(key);
    }
    return heard;
  };
  for (let s = 0; s < 60; s++) step();
  assert.deepEqual(vehicleIds(jolt), [0, 1], 'both vehicles written');
  const ofFirst = [...open].filter((key) => key.split('-').includes('1'));
  assert.deepEqual(ofFirst.sort(), ['0-1', '1-3'], 'the first car touches the floor and its cube');
  writer.remove(1);
  const left = step()
    .filter(([type]) => type === 2)
    .map(([, a, b]) => [a, b].sort((p, q) => p - q).join('-'));
  assert.deepEqual(left.sort(), ofFirst, 'its pairs, and only its pairs, left');
  assert.deepEqual(vehicleIds(jolt), [1], 'its vehicle gone, the other kept');
  assert.ok(open.has('0-2') && open.has('2-4'), 'the other car still touches');
  for (let s = 0; s < 30; s++) step();
  assert.deepEqual(vehicleIds(jolt), [1], 'still gone');
});

test("a floor's pairs, some ended in the middle of its list, all leave with the floor", async () => {
  const jolt = await startModule();
  const writer = new CommandWriter();
  writer.gravity([0, -9.81, 0]);
  writer.add({ ...body(0, 0, -50, 50, FLAG.events), position: [0, -50, 0] });
  for (let n = 1; n <= 6; n++)
    writer.add({ ...body(n, 2, 0, 0.5, FLAG.events), position: [3 * n, 0.5, 0] });
  const left = () =>
    events(jolt)
      .filter(([type]) => type === 2)
      .map(([, a, b]) => [a, b].sort((p, q) => p - q).join('-'));
  // Before the cubes fall asleep (half a second), which ends their pairs.
  for (let s = 0; s < 10; s++) jolt.step(writer.take(), 1 / 60);
  // Cubes 2 and 4 leave: their pairs with the floor end before its list's last entry.
  writer.remove(2);
  writer.remove(4);
  jolt.step(writer.take(), 1 / 60);
  assert.deepEqual(left().sort(), ['0-2', '0-4']);
  writer.remove(0);
  jolt.step(writer.take(), 1 / 60);
  assert.deepEqual(left().sort(), ['0-1', '0-3', '0-5', '0-6'], 'every pair the floor kept left');
});
