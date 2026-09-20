import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseBlockFormat,
  isBlockFormat,
  poolFormat,
  texelBytes,
  WHITE_BLOCK,
} from './textureBlockFormats.ts';

const device = (...names: string[]) => ({ has: (name: string) => names.includes(name) });

// Behaviour: the format follows the device's features under the host's choice — BC7 first on a
// device with both, ASTC alone on a mobile one, RGBA8 with a named reason on neither or on
// `'none'`; an explicit format the device lacks is refused by name, never swapped in silence.
test('the block format is the one the device samples, under the host choice, with its reason', () => {
  const both = device('texture-compression-bc', 'texture-compression-astc');
  assert.deepEqual(chooseBlockFormat(both), {
    block: 'bc7',
    reason: 'device has texture-compression-bc',
  });
  assert.equal(chooseBlockFormat(device('texture-compression-astc')).block, 'astc');
  assert.equal(chooseBlockFormat(both, 'astc').block, 'astc');
  assert.deepEqual(chooseBlockFormat(device(), 'auto'), {
    block: undefined,
    reason: 'device lacks texture-compression-bc and texture-compression-astc',
  });
  assert.deepEqual(chooseBlockFormat(device('texture-compression-astc'), 'bc7'), {
    block: undefined,
    reason: 'device lacks texture-compression-bc',
  });
  assert.deepEqual(chooseBlockFormat(both, 'none'), {
    block: undefined,
    reason: 'host asked for rgba8',
  });
});

test('pool formats keep the colour atlas sRGB-decoded and cost one byte per texel when blocked', () => {
  assert.equal(poolFormat('color', 'bc7'), 'bc7-rgba-unorm-srgb');
  assert.equal(poolFormat('data', 'bc7'), 'bc7-rgba-unorm');
  assert.equal(poolFormat('color', 'astc'), 'astc-4x4-unorm-srgb');
  assert.equal(poolFormat('data', undefined), 'rgba8unorm');
  assert.equal(texelBytes('rgba8unorm-srgb'), 4);
  assert.equal(texelBytes('astc-4x4-unorm'), 1);
  assert.ok(isBlockFormat('bc7-rgba-unorm') && !isBlockFormat('rgba8unorm'));
  assert.equal(WHITE_BLOCK.bc7.length, 16);
  assert.equal(WHITE_BLOCK.astc.length, 16);
});
