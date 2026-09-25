// #725: a still scene schedules no work once its frame targets are granted. The page reads
// `frameHeld` as "nothing more to draw" (`renders/explorer-startup`): a frame held while the device
// still answers for its targets is not that still frame, and says so. Real bricks: the scheduler,
// the WebGPU backend on the mock device, its target grant and its hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplorerFrameScheduler } from '../../world/render/frameScheduler.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, disposeQuadRun, quadBackend, quadScene } from '../pages/testScenes.fixture.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import type { WebgpuPagesBackend } from '../pages/runtime.ts';

const turn = () => new Promise((done) => setImmediate(done));

test('a still scene schedules no work once its resized targets are granted', async () => {
  installGpuGlobals();
  const viewport: [number, number] = [32, 32];
  const { source, metadata, indices, associations } = quadScene();
  const packed = packDagSelection(
    collectClusterPages(source, metadata, indices, associations).roots,
  );
  const run = quadBackend(mockGpu({ packed }).device, { viewport });
  const backend = run.backend as WebgpuPagesBackend & { pendingFrame(): Promise<boolean> };
  try {
    await backend.prepare();
    const cam = camera(),
      requested: FrameRequestCallback[] = [];
    let asked = 0;
    const scheduler = createExplorerFrameScheduler({
      request: (callback) => (asked++, requested.push(callback)),
      cancel() {},
      render: () => backend.render(cam),
      pending: () => backend.pendingFrame(),
      error: (error) => assert.fail(String(error)),
      limited: () => assert.fail('the loop hit its frame limit'),
    });
    /** Runs the loop as the page does, until it idles: the requests made once `frameHeld` said
     *  the scene still, which a page waiting for it would count. */
    const settle = async () => {
      let stillAt: number | undefined;
      for (let round = 0; round < 200; round++) {
        requested.shift()?.(0);
        await turn();
        if (backend.metrics().frameHeld) stillAt ??= asked;
        if (!requested.length && stillAt !== undefined) break;
      }
      assert.ok(stillAt !== undefined, 'the scene settles');
      assert.equal(asked, stillAt, 'no scheduled work once the scene says it is still');
    };
    scheduler.invalidate();
    await settle();
    // The view is resized: its targets are asked of the device, then the scene settles again.
    viewport[0] = viewport[1] = 48;
    scheduler.invalidate();
    await settle();
    scheduler.dispose();
  } finally {
    disposeQuadRun(backend, run.fixture);
  }
});
