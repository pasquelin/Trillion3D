// Device loss: the backend fails without throwing from dispose, unpublishes its canvas, and takes no
// error of the session closed before it on the same device for its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, quadBackend } from '../testScenes.fixture.ts';

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

test("an error the session closed on the device left behind is not the next session's loss", async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  // The device the world keeps: one event target, and a queue whose drain the test releases.
  const events = new EventTarget();
  let drain!: () => void;
  const drained = new Promise<void>((resolve) => {
    drain = resolve;
  });
  Object.assign(device, {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  const uncaptured = () =>
    events.dispatchEvent(
      Object.assign(new Event('uncapturederror'), { error: { message: '[Buffer] is destroyed' } }),
    );
  const first = quadBackend(device);
  await first.backend.prepare();
  first.backend.render(camera());
  Object.assign(device.queue, { onSubmittedWorkDone: () => drained });
  const closed = first.backend.dispose();
  const second = quadBackend(device);
  const opening = second.backend.prepare();
  // Raised by work the closed session submitted: its listener hears it and ignores it.
  uncaptured();
  drain();
  await Promise.all([closed, opening]);
  second.backend.render(camera());
  // Once it listens, an error on the device is its own.
  uncaptured();
  assert.throws(() => second.backend.render(camera()), /WEBGPU_LOST/);
  await second.backend.dispose();
  for (const { fixture } of [first, second]) {
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
