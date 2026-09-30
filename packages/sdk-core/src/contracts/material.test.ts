import assert from 'node:assert/strict';
import test from 'node:test';
import { alphaModeOf } from './material.ts';

test('blending retains priority over alpha cutouts and a zero cutoff stays opaque', () => {
  for (const alphaTest of [0, 0.5, -1])
    assert.equal(alphaModeOf({ transparent: true, alphaTest }), 'blend');
  assert.equal(alphaModeOf({ transparent: false, alphaTest: 0.5 }), 'mask');
  assert.equal(alphaModeOf({ transparent: false, alphaTest: 0 }), 'opaque');
  assert.equal(alphaModeOf({ transparent: false, alphaTest: -1 }), 'opaque');
});
