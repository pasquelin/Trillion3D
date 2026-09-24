// #360, #361: the one rule the WebGL2 binder and a world's host textures read to tell a new
// picture from a sampler change: the sampler alone only when it is proven, any doubt a picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureWords, textureChange } from './contract.ts';

const texture = (fields: Record<string, unknown> = {}) => ({
  version: 1,
  image: {},
  flipY: false,
  colorSpace: 'srgb',
  channel: 0,
  ...fields,
});

test('a new version is a sampler change only when the sampler moved on the same picture', () => {
  const first = texture();
  const held = { version: 1, picture: pictureWords(first) };
  assert.equal(textureChange(held, first, true), 'none', 'the version did not move');
  const next = { ...first, version: 2 };
  assert.equal(textureChange(held, next, true), 'sampler');
  assert.equal(textureChange(held, next, false), 'picture', 'pixels written in place');
  for (const moved of [{ image: {} }, { flipY: true }, { colorSpace: 'linear' }, { channel: 1 }])
    assert.equal(textureChange(held, { ...next, ...moved }, true), 'picture');
  // A texture without upload words — a world's — reads them as absent on both sides.
  assert.equal(
    textureChange(held, { ...next, premultiplyAlpha: true }, true),
    'picture',
    'a word it gained is a picture word too',
  );
});
