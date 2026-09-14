import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { twoCoarseQuadsScene } from './webgpuPagesTestOccluder.ts';

test('surface capture keeps external renders blocked until main-view restoration has finished', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const fixture = quadScene();
  const main = camera();
  let blocked: unknown;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic(event) {
      if (event.phase === 'surface-capture-ready')
        queueMicrotask(() => {
          try {
            backend.render(main);
            blocked = false;
          } catch (error) {
            blocked = String(error);
          }
        });
    },
  });
  try {
    await backend.prepare();
    backend.render(main);
    await backend.flush?.();
    const surface = await backend.captureSurfaceView!(camera(), { width: 16, height: 16 });
    surface.dispose();
    assert.match(String(blocked), /SURFACE_CAPTURE_BUSY/);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('a failed transparent material pipeline cannot leave an HDR pass with an rgba8 fallback pipeline', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const fixture = quadScene();
  fixture.material.transparent = true;
  fixture.material.opacity = 0.5;
  fixture.metadata.primitives[0].pass = 'shared-blend';
  const create = device.createRenderPipeline.bind(device);
  device.createRenderPipeline = (descriptor) => {
    if (
      descriptor.vertex.entryPoint === 'vs' &&
      descriptor.fragment?.targets[0]?.format === 'rgba16float'
    )
      throw new Error('NO_FORWARD_MATERIAL');
    return create(descriptor);
  };
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), true);
    backend.render(camera());
    assert.equal(backend.metrics().submittedTriangles, 2);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('camera jumps and obsolete uploads preserve coverage while detail slots are reclaimed', async () => {
  installGpuGlobals();
  const { device } = mockGpu(),
    fixture = twoCoarseQuadsScene();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  });
  const cam = camera(),
    move = (x: number) => {
      cam.position.set(x, 0, 5);
      cam.lookAt(x, 0, 0);
      cam.updateMatrixWorld();
      backend.render(cam);
      assert.equal(backend.metrics().submittedTriangles, 2);
    };
  try {
    await backend.prepare();
    move(0);
    await backend.flush();
    move(0);
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
    move(100);
    assert.deepEqual(backend.selectedPageIds(), ['b2']);
    await backend.flush();
    move(100);
    assert.deepEqual(backend.selectedPageIds().sort(), ['b0', 'b1']);
    for (let i = 0; i < 12; i++) {
      move(i % 2 ? 100 : 0);
      await Promise.resolve();
    }
    move(0);
    await backend.flush();
    move(0);
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
    assert.ok(backend.metrics().cacheEvictions! > 0);
  } finally {
    backend.dispose();
    fixture.dispose();
  }
});

test('a visible opaque primitive without a hierarchy still has complete exact-page coverage', async () => {
  installGpuGlobals();
  const fixture = quadScene(),
    { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    metadata: { primitives: [{ ...fixture.metadata.primitives[0], hierarchy: null }] },
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
    assert.equal(backend.metrics().submittedTriangles, 2);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
