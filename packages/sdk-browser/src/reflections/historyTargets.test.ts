import assert from 'node:assert/strict';
import test from 'node:test';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createReflectionHistoryTargets } from './historyTargets.ts';

test('history owns exactly 32 bytes per pixel and keeps metadata formats unchanged', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistoryTargets(gpu.device, 3840, 2160);
  assert.equal(history.bytes, 265420800);
  assert.deepEqual(
    gpu.textures.map((t) => t.format),
    ['rgba16float', 'rgba16float', 'depth32float', 'rgba16float', 'r32uint'],
  );
  history.dispose();
  history.dispose();
  assert.equal(gpu.destroyed.length, 5);
  assert.throws(() => history.image, /DISPOSED/);
});

test('history allocation failure releases every preceding target exactly once', () => {
  for (let failAt = 1; failAt <= 5; failAt++) {
    let count = 0;
    const gpu = fakeDevice({ refuse: () => (++count === failAt ? 'throw' : undefined) });
    assert.throws(() => createReflectionHistoryTargets(gpu.device, 64, 32), /NO_MEMORY/);
    assert.equal(gpu.destroyed.length, failAt - 1);
  }
});

test('metadata copies follow its final consumer, depth stays depth-only, and history swaps', () => {
  const gpu = fakeDevice();
  const history = createReflectionHistoryTargets(gpu.device, 64, 32);
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
  assert.equal(gpu.textureCopies.length, 3);
  assert.equal(gpu.textureCopies[0].from.aspect, 'depth-only');
  assert.equal(gpu.textureCopies[0].to.aspect, 'depth-only');
  history.resolve(encoder, current, (read, write) => {
    assert.equal(read, next);
    assert.equal(write, initial);
  });
  assert.equal(history.image, initial);
  history.dispose();
});
