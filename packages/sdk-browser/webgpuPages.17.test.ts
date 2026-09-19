import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { drawnPageIds, installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { coarseQuadScene } from './webgpuPagesTestOccluder.ts';

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
  });
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
  });
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
    // Le repli grossier est la single page dessinable : le masque de l'image le dit, before same
    // que la commande indirecte n'en fasse son compte d'instances.
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
