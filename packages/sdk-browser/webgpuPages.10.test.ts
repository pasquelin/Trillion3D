import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera, quadBackend } from './webgpuPagesTestScenes.ts';

test('opaque materials are rendered before lighting into reusable GPU surface textures', async () => {
  installGpuGlobals();
  const { device, passes } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    backend.render(camera());
    // Les quatre surfaces, puis la cible de retour des textures virtuelles (`r32uint` elle aussi).
    const surface = passes.findIndex(
      (pass) =>
        pass.formats.length === 5 && pass.formats[3] === 'r32uint' && pass.formats[4] === 'r32uint',
    );
    const lighting = passes.findIndex(
      (pass, i) => i > surface && pass.formats.length === 1 && pass.formats[0] === 'rgba16float',
    );
    assert.ok(surface >= 0, 'material pass must write surface properties');
    assert.ok(lighting > surface, 'lighting must consume the material pass');
    assert.equal(backend.metrics().vramBytes, null, 'allocation arithmetic is not physical VRAM');
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('surface capture uses its own camera and restores the main view without copying pixels to CPU', async () => {
  installGpuGlobals();
  const { device, imageCopies } = mockGpu();
  const fixture = quadScene();
  const viewport: [number, number] = [32, 32];
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport,
  });
  try {
    await backend.prepare();
    const main = camera();
    backend.render(main);
    await backend.flush?.();
    backend.render(main);
    await backend.flush?.();
    const before = backend.capture!();
    const other = camera();
    other.position.x = 1;
    other.lookAt(0, 0, 0);
    other.updateMatrixWorld();
    assert.equal(typeof backend.captureSurfaceView, 'function');
    imageCopies.length = 0;
    const surface = await backend.captureSurfaceView!(other, { width: 16, height: 16 });
    assert.equal(surface.version, 1);
    assert.deepEqual(surface.cameraWorld, [1, 0, 5]);
    assert.equal(surface.width, 16);
    assert.equal(surface.selectedTriangles, 2);
    assert.deepEqual(viewport, [32, 32]);
    assert.deepEqual(main.position.toArray(), [0, 0, 5]);
    assert.equal(imageCopies.length, 0, 'secondary views must remain GPU textures');
    await assert.rejects(
      () => backend.captureSurfaceView!(other, { width: 16, height: 16 }),
      /SURFACE_CAPTURE_BUSY/,
    );
    surface.dispose();
    await backend.flush?.();
    assert.deepEqual(backend.capture!(), before);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('explicit captures reject stale images and aborted surface captures leave the main view intact', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    assert.equal(backend.capture!().length, 4096);
    backend.render(camera());
    assert.throws(() => backend.capture!(), /CAPTURE_NOT_READY/);
    assert.equal(typeof backend.captureSurfaceView, 'function');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        backend.captureSurfaceView!(camera(), { width: 16, height: 16, signal: controller.signal }),
      /abort/i,
    );
    await backend.flush?.();
    assert.equal(backend.capture!().length, 4096);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('surface capture rejects missing pages and a budget failure keeps the main viewport', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const fixture = quadScene();
  const viewport: [number, number] = [32, 32];
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    gpuDevice: device,
    maxResidentPages: 2,
    viewport,
    maxFrameAllocationBytes: 100000,
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await assert.rejects(
      () => backend.captureSurfaceView!(camera(), { width: 16, height: 16 }),
      /SURFACE_PAGES_NOT_RESIDENT/,
    );
    assert.deepEqual(viewport, [32, 32]);
    await assert.rejects(
      () => backend.captureSurfaceView!(camera(), { width: 100, height: 100 }),
      /SURFACE_BUDGET/,
    );
    assert.deepEqual(viewport, [32, 32]);
    backend.render(camera());
    assert.equal(backend.metrics().submittedTriangles, 0);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
