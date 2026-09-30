import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandWriter } from './commands.ts';
import { writeDrive, writeUnvehicle } from './vehicleCommands.ts';
import { OP } from './layout.ts';
import { Vehicle } from './vehicle.ts';
import { Mesh } from '../world/object/mesh.ts';
import { box } from '../world/geometry/basic.ts';
import { Material } from '../world/material/material.ts';
import { writeVehicle } from './vehicleCommands.ts';

test('vehicle removal and driver input remain adjacent complete wire records', () => {
  const writer = new CommandWriter();
  writeUnvehicle(writer, 7);
  for (const handbrake of [false, true])
    writeDrive(writer, 9, {
      input: { throttle: 0.25, brake: 0.5, steer: -0.75, handbrake },
    } as Vehicle);
  const words = writer.take(),
    floats = new Float32Array(words.buffer);
  assert.equal(words.length, 14);
  assert.deepEqual([...words.slice(0, 4)], [OP.unvehicle, 7, OP.drive, 9]);
  assert.deepEqual([...floats.slice(4, 8)], [0.25, 0.5, -0.75, 0]);
  assert.deepEqual([...words.slice(8, 10)], [OP.drive, 9]);
  assert.deepEqual([...floats.slice(10, 14)], [0.25, 0.5, -0.75, 1]);
});

test('short torque tables carry negative sentinels and unused gears carry zero', () => {
  const body = new Mesh(box(), new Material('meshStandard'));
  const wheels = [-1, 1, 2].map((z) => {
    const wheel = new Mesh(box(), body.material);
    wheel.position.z = z;
    body.add(wheel);
    return wheel;
  });
  const writer = new CommandWriter();
  writeVehicle(
    writer,
    1,
    2,
    new Vehicle('car', body, { wheels, gears: [1], torqueCurve: [[0, 1]] }),
  );
  const floats = new Float32Array(writer.take().buffer);
  assert.deepEqual([...floats.slice(8, 18)], [0, 1, -1, -1, -1, -1, -1, -1, -1, -1]);
  assert.deepEqual([...floats.slice(21, 27)], [1, 0, 0, 0, 0, 0]);
});
