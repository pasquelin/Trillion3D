import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIVE_WORDS,
  OP,
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
  vehicle,
} from '../../../sdk-core/src/physics/index.ts';
import { box, cylinder } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import { createWorldPhysics } from './worldPhysics.ts';
import { fakeWorkers, loaded } from './worker.fixture.ts';

test('world.physics.add makes the vehicle with its body; driving it, its state and its removal reach both sides', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const body = new Mesh(box(1.8, 0.5, 4), new Material('meshStandard'));
    const wheels = [-1.3, 1.3].flatMap((z) =>
      [-0.8, 0.8].map((x) => {
        const wheel = new Mesh(cylinder(0.3, 0.3, 0.2), new Material('meshStandard'));
        wheel.position.set(x, -0.3, z);
        wheel.rotation.z = Math.PI / 2;
        body.add(wheel);
        return wheel;
      }),
    );
    const car = vehicle.car(body, { wheels });
    physics.handle.add(car);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    physics.frame();
    assert.equal(car._id, -1, 'no body yet: no vehicle');
    body.physics = { mass: 1400 };
    scene.add(body);
    physics.frame();
    let sent = worker.words.at(-1)!;
    const at = sent.indexOf(OP.vehicle);
    assert.ok(at >= 0 && sent[at + 1] === car._id && sent[at + 4] === 4, 'made, four wheels');
    car.drive({ throttle: 1, brake: 0, steer: -1, handbrake: false });
    physics.frame();
    sent = worker.words.at(-1)!;
    const drive = sent.indexOf(OP.drive);
    const floats = new Float32Array(sent.buffer, sent.byteOffset, sent.length);
    assert.deepEqual([...floats.subarray(drive + 2, drive + DRIVE_WORDS)], [1, 0, -1, 0]);
    // A tick's state: 12 m/s in third at 4,000 rpm, the first wheel down 5 cm and steered.
    const state = new Uint32Array(VEHICLE_STATE_WORDS + 4 * WHEEL_STATE_WORDS);
    const f = new Float32Array(state.buffer);
    state.set([car._id, 4]);
    f.set([12, 4000, 3], 2);
    for (let i = 0; i < 4; i++) f.set([0, 0, 0, 0, 0, 0, 1], VEHICLE_STATE_WORDS + i * 7);
    f.set([-0.8, -0.35, -1.3, 0, Math.sin(0.1), 0, Math.cos(0.1)], VEHICLE_STATE_WORDS);
    const tick = {
      poses: 0,
      events: 0,
      dropped: 0,
      steps: 1,
      seconds: 1 / 60,
      stepMs: 0,
      stepMaxMs: 0,
    };
    const buffer = new ArrayBuffer(4);
    const results = { type: 'results', buffer, active: 1, character: null, vehicles: state };
    worker.onmessage({ data: { ...tick, ...results } });
    assert.deepEqual([car.speed, car.rpm, car.gear], [12, 4000, 3]);
    assert.equal(wheels[0].position.y.toFixed(3), '-0.350');
    // The wheel turned about the body's y, then as the page laid it (on its side).
    const q = wheels[0].quaternion;
    assert.ok(Math.abs(q.y) > 0.05 && Math.abs(q.z) > 0.6, `steered on its side: ${q.toArray()}`);
    const id = car._id;
    physics.handle.remove(car);
    physics.frame();
    sent = worker.words.at(-1)!;
    assert.equal(sent[sent.indexOf(OP.unvehicle) + 1], id);
    assert.deepEqual(wheels[0].position.toArray(), [-0.8, -0.3, -1.3], 'its wheels given back');
    assert.equal(car._host, null, 'no write reaches a vehicle out of the simulation');
    physics.dispose();
  } finally {
    restore();
  }
});
