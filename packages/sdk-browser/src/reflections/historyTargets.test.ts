import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createReflectionHistoryTargets } from './historyTargets.ts';

// The last depth and identifiers are the reflection source's (`source.ts`).
const kept = { depth: {} as GPUTextureView, ids: {} as GPUTextureView };

test('history owns 28 bytes per pixel, 8 per traced texel, and reads the last depth and identifiers of the source', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistoryTargets(gpu.device, 3840, 2159, kept);
  assert.equal(history.bytes, 3840 * 2159 * 28 + 1920 * 1080 * 8);
  assert.deepEqual(
    gpu.textures.map((t) => t.format),
    ['rgba16float', 'rgba16float', 'r16float', 'r16float', 'rgba16float', 'rg32uint'],
  );
  // The trace's records, one per half-resolution texel (`sampleWgsl.ts`).
  assert.deepEqual(gpu.textures[5].size, { width: 1920, height: 1080 });
  assert.equal(history.previous.depth, kept.depth);
  assert.equal(history.previous.ids, kept.ids);
  history.dispose();
  history.dispose();
  assert.equal(gpu.destroyed.length, 6);
  assert.throws(() => history.image, /DISPOSED/);
});

test('history allocation failure releases every preceding target exactly once', () => {
  for (let failAt = 1; failAt <= 6; failAt++) {
    let count = 0;
    const gpu = fakeDevice({ refuse: () => (++count === failAt ? 'throw' : undefined) });
    assert.throws(() => createReflectionHistoryTargets(gpu.device, 64, 32, kept), /NO_MEMORY/);
    assert.equal(gpu.destroyed.length, failAt - 1);
  }
});

test('the normal copy follows its final consumer, and history swaps', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistoryTargets(gpu.device, 64, 32, kept);
  const encoder = gpu.device.createCommandEncoder();
  const current = { depth: {} as GPUTexture, normal: {} as GPUTexture, ids: {} as GPUTexture };
  const initial = history.image;
  let next: GPUTextureView | undefined;
  let moment: GPUTextureView | undefined;
  const output = history.resolve(encoder, current, (read, write, moments) => {
    assert.equal(read, initial);
    assert.notEqual(write, read);
    assert.notEqual(moments.output, moments.held);
    moment = moments.output;
    assert.equal(gpu.textureCopies.length, 0, 'old metadata remains available during resolve');
    next = write;
  });
  assert.equal(output, next);
  assert.equal(history.image, next);
  assert.equal(gpu.textureCopies.length, 1);
  history.resolve(encoder, current, (read, write, moments) => {
    assert.equal(read, next);
    assert.equal(write, initial);
    // The moment the last resolve wrote is the one this one reads.
    assert.equal(moments.held, moment);
  });
  assert.equal(history.image, initial);
  history.dispose();
});
