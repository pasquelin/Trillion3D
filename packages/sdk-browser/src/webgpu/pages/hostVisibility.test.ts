import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { camera, flushedGpuScene, quadScene } from './testScenes.fixture.ts';

// A node of a compiled model hidden once, then shown again, by the host (#407). Every frame
// renders and settles, the GPU cut drops the node's pages while it is hidden — its root parked
// as a parked row's is — and takes them back once it is shown.
test('the WebGPU path hides a compiled node the host hid, and draws it again once shown', async () => {
  installGpuGlobals();
  const scene = quadScene();
  const { backend } = await flushedGpuScene(scene);
  const run = backend as typeof backend & { selectedPageIds(): string[] };
  const node = scene.source.children[0];
  /** One frame, as the interactive loop runs it: drawn, then its pending work awaited. */
  const frame = async () => {
    run.render(camera());
    assert.equal(typeof (await run.pendingFrame!()), 'boolean', 'the frame settles');
    return run.selectedPageIds().sort();
  };
  try {
    for (let n = 0; n < 3; n++) assert.deepEqual(await frame(), ['0', '1']);
    node.visible = false;
    await frame(); // the park voids the cut in hand: the next readback is cut without the node
    for (let n = 0; n < 3; n++) {
      assert.deepEqual(await frame(), [], 'hidden, none of its pages is drawn');
      assert.equal(run.metrics().submittedTriangles, 0);
    }
    node.visible = true;
    await frame();
    for (let n = 0; n < 3; n++) {
      assert.deepEqual(await frame(), ['0', '1'], 'shown again, it is drawn again');
      assert.equal(run.metrics().submittedTriangles, 2);
    }
  } finally {
    run.dispose();
    scene.geometry.dispose();
    scene.material.dispose();
  }
});
