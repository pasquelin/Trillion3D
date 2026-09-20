import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBlockFormat, poolEncoding, WHITE_TAIL } from './textureBlockFormats.ts';

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

// Behaviour: one encoding carries everything a block choice implies — the two pool formats,
// the colour one sRGB-decoded, the texel cost, the level file and which tail is pinned.
test('the pool encoding follows the block choice, RGBA8 without one', () => {
  const bc7 = poolEncoding('bc7');
  assert.deepEqual(
    [bc7.color, bc7.data, bc7.texelBytes, bc7.levelFormat],
    ['bc7-rgba-unorm-srgb', 'bc7-rgba-unorm', 1, 'bc7'],
  );
  assert.equal(poolEncoding('astc').color, 'astc-4x4-unorm-srgb');
  const rgba = poolEncoding(undefined);
  assert.deepEqual(
    [rgba.color, rgba.data, rgba.texelBytes, rgba.levelFormat],
    ['rgba8unorm-srgb', 'rgba8unorm', 4, 'png'],
  );
  assert.equal(bc7.tailOf(WHITE_TAIL), WHITE_TAIL.blocks.bc7);
  assert.equal(rgba.tailOf(WHITE_TAIL), WHITE_TAIL.levels);
  assert.equal(WHITE_TAIL.blocks.astc[0].length, 16);
});
