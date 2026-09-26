import test from 'node:test';
import assert from 'node:assert/strict';
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { fakePhysicsWorld, idleTick, poseRecord } from '../../physics/worker.fixture.ts';
import { createWorldFrames } from './worldFrames.ts';

// #740: a world whose host leads (`interactive: false`) runs the physics in `world.render()`
// through the loop's own step, with no controller: it no longer simulates nothing. No Node fixture
// opens a world's session, so the frames and the physics are driven as `render()` drives them.
test('a host-led frame runs the physics as the loop does: its falling body moves', async () => {
  const { scene, physics, worker, restore } = await fakePhysicsWorld();
  try {
    const crate = new Mesh(box(), new Material('meshStandard'));
    crate.physics = 'dynamic';
    crate.position.set(0, 5, 0);
    scene.add(crate);
    const frames = createWorldFrames();
    const render = () => frames.step(null, scene, physics.frame);
    render();
    assert.equal(worker.words.length, 1, 'the frame sent the body to the worker');
    const id = physics.session()!.engineIdOf(crate);
    for (const y of [4.9, 4.6]) {
      const fell = poseRecord(id, [0, y, 0, 0, 0, 0, 1]);
      worker.onmessage({
        data: { ...idleTick, buffer: fell.buffer, poses: 1, steps: 1, active: 1 },
      });
      render();
    }
    assert.equal(crate.position.y.toFixed(1), '4.6', 'drawn where the worker let it fall');
    physics.dispose();
  } finally {
    restore();
  }
});
