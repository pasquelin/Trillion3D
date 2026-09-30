import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { createReflectionSource, type ReflectionSourceInputs } from './source.ts';

function inputsOf(motion = {} as GPUBuffer): ReflectionSourceInputs {
  return {
    ids: {} as GPUTextureView,
    pages: {} as GPUBuffer,
    motion,
    eye: [1, 2, 3],
    metadata: { depth: {} as GPUTexture, ids: {} as GPUTexture },
    placement: 'still',
  };
}

test('the source answers from a kept image on, through the last matrix and live motion', () => {
  const gpu = fakeDevice();
  const source = createReflectionSource(gpu.device, 64, 32, {} as GPUTextureView);
  const inputs = inputsOf();
  const sent = () => gpu.writes.at(-1)!.data as Float32Array;
  source.update(IDENTITY_MATRIX4, [48, 24], inputs);
  assert.equal(sent()[36], 0, 'a first image has no last one: every ray reads the fallback');
  assert.ok(source.group, 'its bind group is made from the inputs');
  const group = source.group;
  source.update(IDENTITY_MATRIX4, [64, 32], inputs);
  assert.equal(sent()[36], 0, 'an image whose depth was not kept is no source');
  source.keep(gpu.device.createCommandEncoder());
  source.update(IDENTITY_MATRIX4, [64, 32], inputs);
  assert.deepEqual(Array.from(sent().slice(36, 39)), [1, 0, 1]);
  // Anchored at the eye, as the placement motion is: the translation column is the eye's image.
  assert.deepEqual(Array.from(sent().slice(12, 15)), [1, 2, 3]);
  assert.deepEqual(Array.from(sent().slice(40, 44)), [64, 32, 1 / 64, 1 / 32], 'last drawn size');
  assert.equal(source.group, group, 'unchanged inputs keep their bind group');
  source.dispose();
  assert.equal(gpu.destroyed.length, 4, 'three targets and the uniform');
});

// #1342: the source reprojected the HDR target, which holds camera fog, the mirror term,
// transparents, water and particles; it reads the lighting's second target alone.
test('the source reads the unfogged image the lighting writes, and the depth it keeps', () => {
  const gpu = fakeDevice();
  const source = createReflectionSource(gpu.device, 64, 32, {} as GPUTextureView);
  const inputs = inputsOf();
  source.update(IDENTITY_MATRIX4, [64, 32], inputs);
  const entries = Array.from(gpu.bindGroups.at(-1)!.entries);
  assert.equal(entries[0].resource, source.target);
  assert.equal(entries[7].resource, source.previous.depth);
  assert.equal(entries[8].resource, source.previous.ids);
  source.keep(gpu.device.createCommandEncoder());
  const [depth, ids] = gpu.textureCopies;
  assert.equal(depth.from.texture, inputs.metadata.depth);
  assert.equal(depth.from.aspect, 'depth-only');
  assert.equal(ids.from.texture, inputs.metadata.ids);
  source.dispose();
});

// #1342: without the temporal pass a mover reprojects to its old pixels; its triangle is checked.
test('a placement moved without live motion asks the triangle check; live motion never does', () => {
  const gpu = fakeDevice();
  const source = createReflectionSource(gpu.device, 8, 8, {} as GPUTextureView);
  const check = () => (gpu.writes.at(-1)!.data as Float32Array)[37];
  const still = inputsOf();
  still.motion = still.pages;
  source.update(IDENTITY_MATRIX4, [8, 8], still);
  source.update(IDENTITY_MATRIX4, [8, 8], still);
  assert.equal(check(), 0, 'nothing moved');
  still.placement = 'turned';
  source.update(IDENTITY_MATRIX4, [8, 8], still);
  assert.equal(check(), 1);
  const live = inputsOf();
  live.placement = 'turned-again';
  source.update(IDENTITY_MATRIX4, [8, 8], live);
  assert.equal(check(), 0, 'live motion brings the mover back itself');
  source.dispose();
});
