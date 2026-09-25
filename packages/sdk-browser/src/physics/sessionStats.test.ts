import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../sdk-core/src/world/object/object3d.ts';
import type { PhysicsResults } from './protocol.ts';
import { createWorldPhysics } from './worldPhysics.ts';
import { fakeWorkers, loaded } from './worker.fixture.ts';

test("a tick's slowest step shows in world.physics.stats.stepMaxMs, beside the mean", async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const crate = new Mesh(box(), new Material('meshStandard'));
    crate.physics = 'dynamic';
    scene.add(crate);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    physics.frame();
    const tick: PhysicsResults = {
      type: 'results',
      buffer: new ArrayBuffer(0),
      poses: 0,
      events: 0,
      dropped: 0,
      steps: 3,
      seconds: 3 / 60,
      water: 0,
      waterEpoch: 0,
      stepMs: 12,
      stepMaxMs: 7.5,
      active: 1,
      character: null,
      vehicles: null,
      soft: null,
    };
    worker.onmessage({ data: tick });
    const { stepMs, stepMaxMs } = physics.handle.stats;
    assert.equal(stepMaxMs, 7.5, 'the slowest step, as the worker sent it');
    assert.equal(stepMs, 4, 'the mean of the three steps');
    physics.dispose();
  } finally {
    restore();
  }
});
