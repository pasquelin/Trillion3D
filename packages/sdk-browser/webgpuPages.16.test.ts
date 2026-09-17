import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { drawnPageIds, installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { dagLevel } from './webgpuPagesTestDag.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { coarseQuadScene } from './webgpuPagesTestOccluder.ts';

test('a host eviction deferred for coverage is applied once the page is no longer pinned', async () => {
  installGpuGlobals();
  const fixture = coarseQuadScene(),
    { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush();
    backend.render(camera());
    backend.dropPage!('0');
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
    const cam = camera();
    cam.lookAt(0, 0, 10);
    backend.render(cam);
    await backend.flush();
    backend.render(camera());
    assert.deepEqual(backend.selectedPageIds(), ['2']);
    assert.deepEqual(backend.pendingUrls!(), ['0']);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('a leaf carrying its own coarse representation keeps that GPU fallback during exact-page loading', async () => {
  installGpuGlobals();
  const fixture = coarseQuadScene(),
    { device } = mockGpu();
  // One cluster replaced by one coarser cluster: a group of a single child.
  const leaf = { ...fixture.metadata.primitives[0].pages[0], count: 6, bytes: 24 };
  const level = dagLevel([leaf], { ...fixture.metadata.primitives[0].pages[2], id: 1 }, 1);
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [{ ...fixture.metadata.primitives[0], ...level }],
  };
  const backend = webgpuPagesBackend({
    ...fixture,
    metadata,
    indices: new Map(),
    readPage: async () => fixture.indices.get('2')!,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    assert.deepEqual(backend.selectedPageIds(), ['2']);
    backend.acceptPage!('0', fixture.indices.get('2')!);
    backend.render(camera());
    await backend.flush();
    backend.render(camera());
    assert.deepEqual(backend.selectedPageIds(), ['0']);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('cancelling initial coverage loading cannot publish a ready backend', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device, draws } = mockGpu(),
    controller = new AbortController();
  let reading!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      reading = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    readPage: async (url) => {
      reading();
      await gate;
      return fixture.indices.get(url)!;
    },
    signal: controller.signal,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    const preparing = backend.prepare();
    await started;
    controller.abort();
    release();
    await assert.rejects(preparing, { name: 'AbortError' });
    assert.equal(backend.metrics().coverageReady, false);
    assert.equal(draws.length, 0);
  } finally {
    release();
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('moving opaque cameras use the current GPU selection without CPU reselection', async () => {
  installGpuGlobals();
  const fixture = quadScene();
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  const packed = packDagSelection(collected.roots);
  const { device, draws, buffers } = mockGpu(undefined, packed);
  const events: Array<{ phase: string; context?: Record<string, unknown> }> = [];
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  });
  try {
    await backend.prepare();
    const cam = camera();
    for (const target of [100, 0, 100, 0]) {
      cam.lookAt(target, 0, target ? 5 : 0);
      cam.updateMatrixWorld();
      draws.length = 0;
      backend.render(cam);
      // La sélection de l'IMAGE EN COURS, lue dans son masque : c'est elle que le raster de calcul
      // consomme sur place, là où l'ancienne commande indirecte portait le compte d'instances.
      assert.equal(
        drawnPageIds(buffers, packed.nodeCount, packed.pageCount).length,
        target ? 0 : 2,
      );
      await backend.flush();
    }
    assert.equal(
      events.filter((event) => event.phase === 'cpu-selection').length,
      0,
      'GPU camera motion must not trigger a duplicate CPU cut',
    );
    assert.ok(events.some((event) => event.phase === 'gpu-selection-current-frame'));
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
