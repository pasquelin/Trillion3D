import test from 'node:test';
import assert from 'node:assert/strict';
import type { Texture } from '../../../../sdk-core/src/index.ts';
import {
  MAX_ANISOTROPY,
  SAMPLE_ANISOTROPY_SHIFT,
  SAMPLE_MAG_NEAREST,
  SAMPLE_MIN_NEAREST,
  SAMPLE_MIP_NEAREST,
  SAMPLE_MIP_NONE,
  SAMPLE_TRANSFORMED,
  SAMPLING_WGSL,
  samplingWords,
  atlasReadWgsl,
} from './sampling.ts';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** An engine texture record with the default sampling, `fields` written over it. */
const record = (fields: Partial<Texture> = {}) =>
  ({
    magFilter: 'linear',
    minFilter: 'linear-mip-linear',
    anisotropy: 1,
    transform: IDENTITY,
    ...fields,
  }) as Texture;

/** The filter word of a texture created in the page, or of one whose levels are the cache's. */
const filterOf = (fields: Partial<Texture>, compiled = false) =>
  samplingWords(record(fields), compiled)[0];

test('the default sampling is the zero word: the read the pools had before', () => {
  assert.deepEqual([...samplingWords(record(), false)], [0, 0x3f800000, 0, 0, 0x3f800000, 0, 0]);
  assert.equal(filterOf({}, true), 0);
});

test('each filter name sets its base filter and mip rule, on a texture created in the page', () => {
  assert.equal(filterOf({ magFilter: 'nearest' }), SAMPLE_MAG_NEAREST);
  assert.equal(filterOf({ minFilter: 'nearest' }), SAMPLE_MIN_NEAREST | SAMPLE_MIP_NONE);
  assert.equal(filterOf({ minFilter: 'linear' }), SAMPLE_MIP_NONE);
  assert.equal(
    filterOf({ minFilter: 'nearest-mip-nearest' }),
    SAMPLE_MIN_NEAREST | SAMPLE_MIP_NEAREST,
  );
  assert.equal(filterOf({ minFilter: 'nearest-mip-linear' }), SAMPLE_MIN_NEAREST);
  assert.equal(filterOf({ minFilter: 'linear-mip-nearest' }), SAMPLE_MIP_NEAREST);
});

// #360, #361: a filter without `mip` on a texture of the compiled cache picks the read inside a
// level, never the level — the engine owns that chain, and its selection and tile requests stay
// those of the default read. On a texture created in the page, WebGL2's rule: level 0.
test('a filter without mip pins level 0 on a page texture, never on a compiled one', () => {
  assert.equal(filterOf({ minFilter: 'linear' }, true), 0, 'the default read');
  assert.equal(filterOf({ minFilter: 'nearest' }, true), SAMPLE_MIN_NEAREST);
  assert.equal(filterOf({ minFilter: 'linear' }), SAMPLE_MIP_NONE);
  assert.equal(
    filterOf({ minFilter: 'nearest-mip-nearest' }, true),
    SAMPLE_MIN_NEAREST | SAMPLE_MIP_NEAREST,
    'a mip rule is the same on both',
  );
});

// #360, #361: as the Three witness grants it (`WebGLTextures.setTextureParameters`), and the
// WebGL2 binder with it: a linear magnification over a chain mixed across levels, or nothing.
test('anisotropy is clamped to the ceiling, and granted only to a linear read mixed across levels', () => {
  const granted = (word: number) => ((word >> SAMPLE_ANISOTROPY_SHIFT) & 15) + 1;
  assert.equal(granted(filterOf({ anisotropy: 8 })), 8);
  assert.equal(granted(filterOf({ anisotropy: 64 })), MAX_ANISOTROPY);
  assert.equal(granted(filterOf({ anisotropy: 0 })), 1);
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'nearest-mip-linear' })), 16);
  assert.equal(granted(filterOf({ anisotropy: 16, magFilter: 'nearest' })), 1);
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'linear-mip-nearest' })), 1);
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'linear' })), 1);
});

// #360, #361: the alpha cutout of the visibility and shadow passes reads one tap at the isotropic
// level; the colour it shades takes the taps its footprint's elongation asks.
test('a cutout read takes one tap, a shaded read the taps of its footprint', () => {
  const shaded = atlasReadWgsl('colorSample', 'color', 'vec4f', true),
    cutout = atlasReadWgsl('maskAlpha', 'color', 'f32', false);
  assert.match(shaded, /colorRead\(slot,s,uv,ddx,ddy,true\)/);
  assert.match(shaded, /for\(var i=0u;i<r\.taps/);
  assert.match(cutout, /colorRead\(slot,s,uv,ddx,ddy,false\)/);
  assert.doesNotMatch(cutout, /r\.taps/);
  // Face-on, up to rounding, the footprint is not elongated: one tap at the isotropic level.
  assert.match(
    SAMPLING_WGSL,
    /if\(ratio>1\.01\)\{\s*raw-=log2\(ratio\);\s*taps=u32\(ceil\(ratio-0\.01\)\)/,
  );
});

test('the affine part of the transform is carried, and flagged when it is not the identity', () => {
  // Repeat 4 × 2, offset (0.25, 0.5), a quarter turn: three columns of three.
  const transform = [0, -2, 0, 4, 0, 0, 0.25, 0.5, 1];
  const words = samplingWords(record({ transform }), false);
  assert.equal(words[0], SAMPLE_TRANSFORMED);
  assert.deepEqual([...new Float32Array(words.buffer, 4, 6)], [0, -2, 4, 0, 0.25, 0.5]);
});
