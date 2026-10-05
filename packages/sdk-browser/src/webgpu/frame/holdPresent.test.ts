// S13: a canvas keeps the image last presented into it — WebGPU replaces its drawing buffer only
// when a texture is taken from it, when it is configured or sized. A held frame whose image the
// canvas still shows whole encodes nothing, and a capture reads it without presenting it again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { holdWebgpuFrame, keepWebgpuFrame } from './hold.ts';
import { settledRt } from './hold.fixture.ts';
import { createGpuPresenter } from '../../gpu/core/presentation.ts';
import { captureImage } from '../pages/io/hostApi.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { pipelinesSettled } from '../../lighting/deferred/fullscreen.ts';

/** A settled runtime whose last frame was drawn and presented whole, as `submitColorCopy` does,
 *  into a canvas that counts the textures taken from it, on a device that counts its encoders; the
 *  presenter's program compiled, as prepare leaves it (`pipelinesSettled`). */
async function presented() {
  const { device } = fakeDevice();
  const counts = { encoders: 0, taken: 0 };
  const encoder = device.createCommandEncoder.bind(device);
  const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} };
  device.createCommandEncoder = (descriptor) => {
    counts.encoders++;
    return Object.assign(encoder(descriptor), { beginRenderPass: () => pass });
  };
  const texture = () => (counts.taken++, { createView: () => ({}) });
  const context = { configure() {}, unconfigure() {}, getCurrentTexture: texture };
  const canvas = { width: 4, height: 4, getContext: () => context } as unknown as HTMLCanvasElement;
  const image = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: 0 });
  const rt = settledRt();
  const presenter = createGpuPresenter(device, canvas);
  await pipelinesSettled(device);
  Object.assign(rt.gpu, { device, presenter, displayTexture: image });
  // Two identical frames arm the hold.
  for (let i = 0; i < 2; i++) {
    rt.run.frame++;
    keepWebgpuFrame(rt);
  }
  presenter.present(device.createCommandEncoder(), image, 4, 4);
  rt.run.imageRevision = 1;
  counts.encoders = counts.taken = 0;
  /** Encoders made and canvas textures taken since the last call. */
  const spent = () => {
    const now = [counts.encoders, counts.taken];
    counts.encoders = counts.taken = 0;
    return now;
  };
  return { rt, canvas, device, presenter, image, spent };
}

test('S13: a held frame after a presented one encodes nothing, and submits nothing', async () => {
  const { rt, device, spent } = await presented();
  for (let i = 0; i < 3; i++) {
    assert.equal(holdWebgpuFrame(rt, device), true);
    assert.deepEqual(spent(), [0, 0], 'no encoder, no canvas texture taken');
  }
  assert.equal(rt.run.frameHeld, true);
  assert.equal(rt.run.imageRevision, 1, 'no image was submitted');
  assert.equal(rt.run.gpuDrawCalls, 0, 'not even a present');
});

test('S13: after its canvas is sized, or a view presented on it, a held frame presents once', async () => {
  const { rt, canvas, device, presenter, image, spent } = await presented();
  canvas.width = 8;
  assert.equal(holdWebgpuFrame(rt, device), true);
  assert.deepEqual(spent(), [1, 1], 'a canvas sized by its owner shows nothing it was given');
  assert.deepEqual([canvas.width, rt.run.imageRevision, rt.run.gpuDrawCalls], [4, 2, 1]);
  holdWebgpuFrame(rt, device);
  assert.deepEqual(spent(), [0, 0], 'presented again, it holds the image');
  // Sized to the size it had, as `canvasResized` reports: blank all the same.
  presenter.forget();
  holdWebgpuFrame(rt, device);
  assert.deepEqual(spent(), [1, 1]);
  // A persistent view drew its rectangle over it: the canvas no longer shows the image whole.
  presenter.present(device.createCommandEncoder(), image, 2, 2, {
    x: 0,
    y: 0,
    width: 2,
    height: 2,
  });
  spent();
  holdWebgpuFrame(rt, device);
  assert.deepEqual(spent(), [1, 1]);
  // Another display image, the same canvas: what it shows is not that image.
  rt.gpu.displayTexture = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: 0 });
  holdWebgpuFrame(rt, device);
  assert.deepEqual(spent(), [1, 1]);
});

test('S13: a capture after a presented frame reads the canvas without encoding', async () => {
  const { rt, presenter, spent } = await presented();
  const pixels = new Uint8Array(64);
  let read = 0;
  rt.gpu.synchronousCapture = { read: () => (read++, pixels), dispose() {} };
  assert.equal(captureImage(rt), pixels);
  assert.deepEqual([...spent(), read], [0, 0, 1], 'the canvas already holds the image');
  presenter.forget();
  rt.capture.capturedPixels = undefined;
  captureImage(rt);
  assert.deepEqual([...spent(), read], [1, 1, 2], 'a canvas that may not hold it is presented');
});
