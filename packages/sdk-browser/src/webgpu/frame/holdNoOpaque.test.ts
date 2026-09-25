// #198: the occluder history is established by the partition alone, and the partition runs only on
// opaque rows. A view with none — blend clusters alone, the sky — never cleared the bit and never
// held its frame. It no longer counts there, and still counts as soon as a row is packed. The row
// change flag was consumed by the opaque path alone as well: every submitted image now does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { unsettledMask, unsettledReasons } from './hold.ts';
import { settledRt } from './hold.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { TAA_STILL_FRAMES } from '../../taa/jitter.ts';
import { camera, flushedGpuScene, quadScene } from '../pages/testScenes.fixture.ts';

test('#198: a view without a packed row owes no occluder history', () => {
  const rt = settledRt();
  rt.run.noOccluderHistory = true;
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['noOccluderHistory']);
  rt.layout.rows.packedCount = 0;
  assert.equal(unsettledMask(rt), 0, 'nothing to partition: the frame may be held');
  rt.layout.rows.packedCount = 1;
  assert.deepEqual(
    unsettledReasons(unsettledMask(rt)),
    ['noOccluderHistory'],
    'the missing history still waits for the first packed row',
  );
});

/** Renders the still view as a host does, frame after frame; the index of the first held one. A
 *  few frames to settle the cut, then the full temporal cycle a held frame waits for. */
async function firstHeld(backend: Awaited<ReturnType<typeof flushedGpuScene>>['backend']) {
  for (let frame = 0; frame < TAA_STILL_FRAMES + 8; frame++) {
    backend.render(camera());
    await backend.flush!();
    if (backend.metrics().frameHeld) return frame;
  }
  return -1;
}

test('#198: a still view of blend clusters alone holds its frame, and a moved one redraws', async () => {
  installGpuGlobals();
  const scene = quadScene();
  scene.metadata.primitives[0].pass = 'clustered-blend';
  scene.material.transparent = true;
  scene.material.opacity = 0.5;
  const { backend } = await flushedGpuScene(scene);
  try {
    assert.notEqual(await firstHeld(backend), -1, 'the still blend-only view is held');
    scene.source.children[0].position.x = 0.25;
    scene.source.updateMatrixWorld(true);
    backend.render(camera());
    assert.equal(backend.metrics().frameHeld, false, 'a moved blend surface is drawn again');
  } finally {
    backend.dispose();
    scene.geometry.dispose();
    scene.material.dispose();
  }
});
