// Device loss: the backend fails without throwing from dispose and unpublishes its canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, quadBackend } from './testScenes.fixture.ts';

test('a lost WebGPU device fails the backend without throwing from dispose', async () => {
  installGpuGlobals();
  const { device, lose } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  lose('destroyed');
  await Promise.resolve();
  assert.throws(() => backend.render(camera()), /WEBGPU_LOST/);
  await backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('the lost promise unpublishes the composed canvas and names WEBGPU_LOST', async () => {
  installGpuGlobals();
  const { device, lose } = mockGpu();
  let unconfigured = false;
  const canvas = {
    width: 1,
    height: 1,
    getContext: () => ({
      configure() {},
      getCurrentTexture: () => ({ createView: () => ({}) }),
      unconfigure() {
        unconfigured = true;
      },
    }),
  };
  // The composed presentation needs a canvas of the engine's own: the document hands it out.
  Object.assign(globalThis, { document: { createElement: () => canvas } });
  const events: Array<{ phase: string; context: Record<string, unknown> }> = [];
  const { fixture, backend } = quadBackend(device, {
    onDiagnostic: (e) => {
      // Announced after the withdrawal: a host drawing on it already finds no canvas.
      if (e.phase === 'gpu-device-lost') assert.equal(backend.presentedSurface, undefined);
      events.push(e);
    },
  });
  try {
    await backend.prepare();
    backend.render(camera());
    assert.equal(backend.presentedSurface, canvas, 'the composed canvas is published');
    lose('destroyed');
    await Promise.resolve();
    assert.equal(backend.presentedSurface, undefined, 'a lost device publishes no canvas');
    assert.equal(unconfigured, true, 'the drawing buffer is blanked');
    assert.equal(backend.metrics().frameHeld, false);
    const lost = events.find((e) => e.phase === 'gpu-device-lost');
    assert.equal(lost?.context.code, 'WEBGPU_LOST');
    assert.equal(lost?.context.reason, 'destroyed');
    assert.throws(() => backend.render(camera()), /WEBGPU_LOST/);
  } finally {
    await backend.dispose();
    delete (globalThis as { document?: unknown }).document;
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
