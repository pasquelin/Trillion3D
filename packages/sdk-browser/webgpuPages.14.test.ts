import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { coarseQuadScene } from './webgpuPagesTestOccluder.ts';

test('detail replaces the complete GPU fallback only after every replacement is uploaded', async () => {
  installGpuGlobals();
  const fixture = coarseQuadScene(),
    { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    readPage: async (url) => fixture.indices.get(url)!,
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  }) as ReturnType<typeof webgpuPagesBackend> & { selectedPageIds(): string[] };
  try {
    await backend.prepare();
    backend.render(camera());
    assert.deepEqual(backend.selectedPageIds(), ['2']);
    backend.acceptPage!('0', fixture.indices.get('0')!);
    backend.syncResident!();
    await backend.flush?.();
    backend.render(camera());
    assert.deepEqual(
      backend.selectedPageIds(),
      ['2'],
      'one GPU detail page cannot replace the full fallback',
    );
    backend.dropPage!('2');
    backend.dropPage!('0');
    backend.acceptPage!('1', fixture.indices.get('1')!);
    backend.syncResident!();
    assert.deepEqual(backend.selectedPageIds(), ['2'], 'CPU arrival is not GPU residency');
    await backend.flush?.();
    backend.render(camera());
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
    assert.equal(backend.metrics().submittedTriangles, 2);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('a refinement exceeding the GPU budget retains the complete fallback and reports the limit', async () => {
  installGpuGlobals();
  const fixture = coarseQuadScene(),
    { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  }) as ReturnType<typeof webgpuPagesBackend> & { selectedPageIds(): string[] };
  try {
    await backend.prepare();
    for (let i = 0; i < 4; i++) {
      backend.render(camera());
      await backend.flush?.();
      assert.deepEqual(backend.selectedPageIds(), ['2']);
      assert.equal(backend.metrics().submittedTriangles, 2);
      assert.equal(backend.metrics().coverageBudgetLimited, true);
      assert.deepEqual(backend.pendingUrls!(), []);
    }
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('a failed initial page reader rejects preparation before exposing a partial scene', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device, draws } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    readPage: async () => {
      throw new Error('PAGE_STREAM_FAILED');
    },
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await assert.rejects(backend.prepare(), /PAGE_STREAM_FAILED/);
    assert.equal(draws.length, 0);
    assert.equal(backend.metrics().coverageReady, false);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('streaming completion during image readback preserves the captured frame and resumes on render', async () => {
  installGpuGlobals();
  const fixture = coarseQuadScene(),
    { device, passes, imageCopies } = mockGpu();
  const createBuffer = device.createBuffer.bind(device);
  let mapped!: () => void, release!: () => void;
  const mapping = new Promise<void>((resolve) => {
    mapped = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  device.createBuffer = (descriptor) => {
    const buffer = createBuffer(descriptor);
    if (descriptor.label === 'WG explicit capture')
      buffer.mapAsync = async () => {
        mapped();
        await gate;
      };
    return buffer;
  };
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    readPage: async (url) => fixture.indices.get(url)!,
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    const flushing = backend.flush?.();
    await mapping;
    const before = passes.length;
    assert.deepEqual(backend.pendingUrls?.().sort(), ['0', '1']);
    for (const [url, array] of fixture.indices) backend.acceptPage?.(url, array);
    backend.syncResident?.();
    backend.syncResident?.();
    release();
    await flushing;
    assert.equal(passes.length, before, 'streaming must not overwrite an image being captured');
    assert.equal(backend.capture!().length, 32 * 32 * 4);
    assert.deepEqual(backend.pendingUrls?.(), [], 'pages arriving during capture remain accepted');
    assert.equal(imageCopies.length, 1, 'the capture must not spin on streaming updates');
    backend.render(camera());
    await backend.flush?.();
    backend.render(camera());
    assert.equal(
      backend.metrics().submittedTriangles,
      2,
      'accepted geometry is rendered on subsequent frames',
    );
  } finally {
    release();
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
