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
  samplingWords,
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

const filterOf = (fields: Partial<Texture>) => samplingWords(record(fields))[0];

test('the default sampling is the zero word: the read the pools had before', () => {
  assert.deepEqual([...samplingWords(record())], [0, 0x3f800000, 0, 0, 0x3f800000, 0, 0]);
});

test('each filter name sets its base filter and mip rule', () => {
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

// As the WebGL2 binder sets it (`webgl/cluster/textures.ts`): whatever the filters.
test('anisotropy is clamped to the ceiling, and granted whatever the filters', () => {
  const granted = (word: number) => ((word >> SAMPLE_ANISOTROPY_SHIFT) & 15) + 1;
  assert.equal(granted(filterOf({ anisotropy: 8 })), 8);
  assert.equal(granted(filterOf({ anisotropy: 64 })), MAX_ANISOTROPY);
  assert.equal(granted(filterOf({ anisotropy: 0 })), 1);
  assert.equal(granted(filterOf({ anisotropy: 16, magFilter: 'nearest' })), 16);
  assert.equal(granted(filterOf({ anisotropy: 16, minFilter: 'linear-mip-nearest' })), 16);
});

test('the affine part of the transform is carried, and flagged when it is not the identity', () => {
  // Repeat 4 × 2, offset (0.25, 0.5), a quarter turn: three columns of three.
  const transform = [0, -2, 0, 4, 0, 0, 0.25, 0.5, 1];
  const words = samplingWords(record({ transform }));
  assert.equal(words[0], SAMPLE_TRANSFORMED);
  assert.deepEqual([...new Float32Array(words.buffer, 4, 6)], [0, -2, 4, 0, 0.25, 0.5]);
});
