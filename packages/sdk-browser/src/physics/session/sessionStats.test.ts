import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts';
import { BODY_INDEX, OP } from '../../../../sdk-core/src/physics/index.ts';
import { createWorldPhysics } from '../worldPhysics.ts';
import { fakeWorkers, idleTick, loaded } from '../worker.fixture.ts';

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
    const tick = { ...idleTick, steps: 3, step: 3, stepMs: 12, stepMaxMs: 7.5, active: 1 };
    worker.onmessage({ data: tick });
    const { stepMs, stepMaxMs } = physics.handle.stats;
    assert.equal(stepMaxMs, 7.5, 'the slowest step, as the worker sent it');
    assert.equal(stepMs, 4, 'the mean of the three steps');
    physics.dispose();
  } finally {
    restore();
  }
});

test('a soft body brought back to a good state is counted in world.physics.stats and named in a PHYSICS_DIVERGED that stops nothing', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const crate = new Mesh(box(), new Material('meshStandard'));
    crate.name = 'crate';
    crate.physics = 'dynamic';
    scene.add(crate);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    physics.frame();
    assert.equal(physics.handle.stats.softRecoveries, 0);
    const errors = console.error;
    console.error = () => {};
    // The worker names bodies by engine id: the one the page's ADD gave the crate.
    const words = worker.words.flatMap((w) => [...w]);
    const at = words.findIndex(
      (w, i) => w === OP.add && (words[i + 1] & BODY_INDEX) === crate.physics!._index,
    );
    const id = words[at + 1];
    try {
      worker.onmessage({ data: { type: 'recovered', bodies: [id] } });
      worker.onmessage({ data: { type: 'recovered', bodies: [id] } });
    } finally {
      console.error = errors;
    }
    assert.equal(physics.handle.stats.softRecoveries, 2, 'each time it was brought back');
    const error = physics.handle.error as { code: string; details?: { names?: string[] } } | null;
    assert.equal(error?.code, 'PHYSICS_DIVERGED');
    assert.deepEqual(error?.details?.names, ['crate'], 'named');
    assert.equal(physics.handle.enabled, true, 'the simulation runs on');
    assert.ok(crate.physics!._index >= 0, 'the body stays in it');
    physics.dispose();
  } finally {
    restore();
  }
});
