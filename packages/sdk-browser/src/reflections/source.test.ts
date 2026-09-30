import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { createReflectionSource, type ReflectionSourceInputs } from './source.ts';

test('the source answers from the second image on, through the last matrix and live motion', () => {
  const gpu = fakeDevice();
  const source = createReflectionSource(gpu.device, 64, 32, {} as GPUTextureView);
  const inputs: ReflectionSourceInputs = {
    last: {} as GPUTextureView,
    ids: {} as GPUTextureView,
    pages: {} as GPUBuffer,
    motion: {} as GPUBuffer,
    reprojects: true,
    eye: [1, 2, 3],
  };
  const sent = () => gpu.writes.at(-1)!.data as Float32Array;
  source.update(IDENTITY_MATRIX4, [48, 24], inputs);
  assert.equal(sent()[36], 0, 'a first image has no last one: every ray reads the fallback');
  assert.ok(source.group, 'its bind group is made from the inputs');
  const group = source.group;
  source.update(IDENTITY_MATRIX4, [64, 32], inputs);
  assert.deepEqual(Array.from(sent().slice(36, 39)), [1, 0, 1]);
  // Anchored at the eye, as the placement motion is: the translation column is the eye's image.
  assert.deepEqual(Array.from(sent().slice(12, 15)), [1, 2, 3]);
  assert.deepEqual(Array.from(sent().slice(40, 44)), [48, 24, 1 / 64, 1 / 32], 'last drawn size');
  assert.equal(source.group, group, 'unchanged inputs keep their bind group');
  source.dispose();
  assert.equal(gpu.destroyed.length, 1);
});
