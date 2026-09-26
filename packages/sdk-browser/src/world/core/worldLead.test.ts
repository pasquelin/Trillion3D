import test from 'node:test';
import assert from 'node:assert/strict';
import { POSE_WORDS } from '../../../../sdk-core/src/physics/index.ts';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts';
import { createWorldPhysics } from '../../physics/worldPhysics.ts';
import { fakeWorkers, idleTick, loaded } from '../../physics/worker.fixture.ts';
import { createWorldFrames } from './worldFrames.ts';

/** A tick that places body `id` at height `y`, drawn at once. */
const fell = (id: number, y: number) => {
  const words = new Uint32Array(POSE_WORDS);
  words[0] = id;
  new Float32Array(words.buffer).set([0, y, 0, 0, 0, 0, 1], 1);
  return { ...idleTick, buffer: words.buffer, poses: 1, steps: 1, active: 1 };
};

// #740: a world whose host leads (`interactive: false`) runs the physics in `world.render()`
// through the loop's own step, with no controller: it no longer simulates nothing. No Node fixture
// opens a world's session, so the frames and the physics are driven as `render()` drives them.
test('a host-led frame runs the physics as the loop does: its falling body moves', async () => {
  const { workers, restore } = fakeWorkers();
  try {
    const scene = new Group();
    const runtime = { invalidate() {}, explorer: null };
    const physics = createWorldPhysics(runtime, scene, () => new Camera('perspective'), true);
    const crate = new Mesh(box(), new Material('meshStandard'));
    crate.physics = 'dynamic';
    crate.position.set(0, 5, 0);
    scene.add(crate);
    await loaded();
    const [worker] = workers;
    worker.onmessage({ data: { type: 'ready' } });
    const frames = createWorldFrames();
    const render = () => frames.step(null, scene, physics.frame);
    render();
    assert.equal(worker.words.length, 1, 'the frame sent the body to the worker');
    const id = physics.session()!.engineIdOf(crate);
    for (const y of [4.9, 4.6]) {
      worker.onmessage({ data: fell(id, y) });
      render();
    }
    assert.equal(crate.position.y.toFixed(1), '4.6', 'drawn where the worker let it fall');
    physics.dispose();
  } finally {
    restore();
  }
});
