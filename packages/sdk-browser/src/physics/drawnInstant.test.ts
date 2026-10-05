import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHYSICS_STEP,
  SOFT_STATE_WORDS,
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
} from '../../../sdk-core/src/physics/index.ts';
import { vehicle } from '../../../sdk-core/src/physics/vehicle.ts';
import { HUMAN_BODY } from '../../../sdk-core/src/collision/characterSettings.ts';
import { box, cylinder, plane } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { fakePhysicsWorld, idleTick, poseRecord } from './worker.fixture.ts';

const material = new Material('meshStandard');

/** A car of four wheels and a cloth of four vertices in the scene of `world`. */
function carAndCloth({ scene, physics }: Awaited<ReturnType<typeof fakePhysicsWorld>>) {
  const body = new Mesh(box(1.8, 0.5, 4), material);
  const wheels = [-1.3, 1.3].flatMap((z) =>
    [-0.8, 0.8].map((x) => {
      const wheel = new Mesh(cylinder(0.3, 0.3, 0.2), material);
      wheel.position.set(x, -0.3, z);
      body.add(wheel);
      return wheel;
    }),
  );
  const car = vehicle.car(body, { wheels });
  body.physics = { mass: 1400 };
  physics.handle.add(car);
  scene.add(body);
  const cloth = new Mesh(plane(1, 1, 1, 1), material);
  cloth.physics = { type: 'cloth' };
  scene.add(cloth);
  return { body, wheels, car, cloth };
}

test('wheels, soft bodies and the character are drawn at the bodies’ time, between the same two steps', async () => {
  const world = await fakePhysicsWorld();
  const { physics, worker, restore } = world;
  try {
    const { body, wheels, car, cloth } = carAndCloth(world);
    const feet = physics.character.body()!({ ...HUMAN_BODY });
    const keys = { wishX: 0, wishZ: 0, sprint: false };
    // A step and a half, then a step: the next frame draws half a step past step 1.
    for (const seconds of [1.5 * PHYSICS_STEP, PHYSICS_STEP]) {
      physics.time(seconds);
      physics.frame();
    }
    const session = physics.session()!;
    /** The worker's results after step `step`: everything `y` metres up (the wheel down). */
    const tick = (step: number, y: number) => {
      const vehicles = new Uint32Array(VEHICLE_STATE_WORDS + 4 * WHEEL_STATE_WORDS);
      vehicles.set([car._id, 4]);
      for (let i = 0; i < 4; i++)
        new Float32Array(vehicles.buffer).set([0, -y, 0, 0, 0, 0, 1], VEHICLE_STATE_WORDS + i * 7);
      const soft = new Uint32Array(SOFT_STATE_WORDS + 4 * 3);
      soft.set([session.engineIdOf(cloth), 4]);
      for (let v = 0; v < 4; v++) new Float32Array(soft.buffer).set([0, y, 0], 2 + v * 3);
      // The feet a step before and now (`recordTick.ts`: id 0, one item of 3 words).
      const [now, before] = [y, y - 1].map((at) => {
        const words = Uint32Array.of(0, 1, 0, 0, 0);
        new Float32Array(words.buffer).set([0, at, 0], 2);
        return words;
      });
      const words = poseRecord(session.engineIdOf(body), [0, y, 0, 0, 0, 0, 1]);
      const data = {
        ...{ ...idleTick, buffer: words.buffer, poses: 1, steps: 1, step, active: 1 },
        ...{ vehicles: { words: vehicles, befores: null }, soft: { words: soft, befores: null } },
        character: { velocity: [0, 0, 0], grounded: true, landed: -1, jumps: 0 },
        feet: { words: now, befores: before },
      };
      worker.onmessage({ data });
    };
    tick(1, 1);
    tick(2, 2);
    // The frame's time is set first; the controller moves the character, then the rest is drawn.
    physics.time(0);
    const drawn = feet.advance(0, keys)[1];
    physics.frame();
    const vertices = cloth.physics!.vertices!.filter((_, i) => i % 3 === 1);
    assert.deepEqual(
      [drawn, body.position.y, -wheels[0].position.y, ...new Set(vertices)],
      [1.5, 1.5, 1.5, 1.5],
      'half way from step 1 to step 2, all four',
    );
    physics.dispose();
  } finally {
    restore();
  }
});
