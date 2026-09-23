import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './pages.ts';
import { collectClusterPages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera } from './testScenes.fixture.ts';
import { coarseQuadScene } from './testOccluder.fixture.ts';
import type { WebgpuPagesBackend } from './runtime.ts';

test('a GPU-driven image reaches the queue as one command buffer', async () => {
  installGpuGlobals();
  const fixture = quadScene();
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const { device, submits } = mockGpu(undefined, packDagSelection(collected.roots));
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  }) as WebgpuPagesBackend;
  try {
    await backend.prepare();
    const cam = camera();
    backend.render(cam);
    await backend.flush();
    for (const target of [100, 0, 100]) {
      cam.lookAt(target, 0, target ? 5 : 0);
      cam.updateMatrixWorld();
      submits.length = 0;
      backend.render(cam);
      // The selection used to submit its own buffer ahead of the render encoder, which left a host gap
      // inside the image's own GPU span. One image, one buffer.
      assert.equal(submits.length, 1, `image looking at ${target}`);
      await backend.flush();
    }
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('GPU streaming exposes wanted pages after readback and draws an atomic resident fallback', async () => {
  installGpuGlobals();
  const fixture = coarseQuadScene();
  fixture.metadata.primitives[0].pages[2].count = 3;
  fixture.metadata.primitives[0].pages[2].bytes = 12;
  fixture.indices.set('2', new Uint32Array([0, 1, 2]));
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const packed = packDagSelection(collected.roots);
  const { device, draws, buffers } = mockGpu(undefined, packed);
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    readPage: async (url) => fixture.indices.get(url)!,
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  }) as WebgpuPagesBackend;
  const render = () => {
    draws.length = 0;
    backend.render(camera());
  };
  try {
    await backend.prepare();
    render();
    assert.equal(
      backend.metrics().submittedTriangles,
      null,
      'do not report candidate counts as GPU results',
    );
    await backend.flush();
    assert.deepEqual(
      backend.pendingUrls?.().sort(),
      ['0', '1'],
      'async desired cut is visible to streaming immediately',
    );
    assert.deepEqual(backend.selectedPageIds(), ['2']);
    // The published cut is the coarse fallback, and that is what `selectedTriangles` reports: the cut
    // after the fallback, like the WebGL backend. Nothing of it is missing, so there is no hole.
    assert.equal(backend.metrics().selectedTriangles, 1);
    assert.equal(backend.metrics().submittedTriangles, 1);
    assert.equal(backend.metrics().uncoveredTriangles, 0);
    backend.acceptPage!('0', fixture.indices.get('0')!);
    render();
    await backend.flush();
    render();
    await backend.flush();
    assert.deepEqual(backend.selectedPageIds(), ['2']);
    // The coarse fallback is the only drawable page: the frame mask says so, even before the
    // indirect command turns it into its instance count.
    assert.equal(drawnPageIds(buffers, packed.nodeCount, packed.pageCount).length, 1);
    backend.acceptPage!('1', fixture.indices.get('1')!);
    render();
    await backend.flush();
    render();
    await backend.flush();
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
    assert.equal(backend.metrics().submittedTriangles, 2);
    assert.equal(
      drawnPageIds(buffers, packed.nodeCount, packed.pageCount).length,
      2,
      'coarse is absent once all fine pages are drawable',
    );
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
