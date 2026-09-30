import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createReflectionHistoryTargets } from './historyTargets.ts';

// The last depth and identifiers are the reflection source's (`source.ts`).
const kept = { depth: {} as GPUTextureView, ids: {} as GPUTextureView };

test('history owns exactly 24 bytes per pixel and reads the last depth and identifiers of the source', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistoryTargets(gpu.device, 3840, 2160, kept);
  assert.equal(history.bytes, 3840 * 2160 * 24);
  assert.deepEqual(
    gpu.textures.map((t) => t.format),
    ['rgba16float', 'rgba16float', 'rgba16float'],
  );
  assert.equal(history.previous.depth, kept.depth);
  assert.equal(history.previous.ids, kept.ids);
  history.dispose();
  history.dispose();
  assert.equal(gpu.destroyed.length, 3);
  assert.throws(() => history.image, /DISPOSED/);
});

test('history allocation failure releases every preceding target exactly once', () => {
  for (let failAt = 1; failAt <= 3; failAt++) {
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
  const output = history.resolve(encoder, current, (read, write) => {
    assert.equal(read, initial);
    assert.notEqual(write, read);
    assert.equal(gpu.textureCopies.length, 0, 'old metadata remains available during resolve');
    next = write;
  });
  assert.equal(output, next);
  assert.equal(history.image, next);
  assert.equal(gpu.textureCopies.length, 1);
  history.resolve(encoder, current, (read, write) => {
    assert.equal(read, next);
    assert.equal(write, initial);
  });
  assert.equal(history.image, initial);
  history.dispose();
});
