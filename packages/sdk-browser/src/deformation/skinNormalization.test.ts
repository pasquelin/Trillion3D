import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { DEFORM_WGSL } from './deformWgsl.ts';

test('GPU skin blending normalizes source weights without changing their stored bytes', () => {
  const weights = new Float32Array([0.2, 0.3]);
  const before = weights.slice();
  const { deformSkin } = shaderRun<{
    deformSkin: (
      header: { influences: number },
      page: object,
      vertex: number,
      at: number,
      count: number,
      point: number[],
    ) => number[];
  }>(DEFORM_WGSL, ['deformSkin'], {
    deformWeight: (_h: unknown, _p: unknown, _v: number, k: number) => weights[k],
    deformJointId: (_h: unknown, _p: unknown, _v: number, k: number) => k,
    // Scalar multiplication is the identity palette's action on this vector.
    deformJoint: () => 1,
  });
  const point = [2, 3, 4, 1];
  assert.deepEqual(deformSkin({ influences: 2 }, {}, 0, 0, 2, point), point.slice(0, 3));
  assert.deepEqual(weights, before);
  weights.fill(0);
  assert.deepEqual(deformSkin({ influences: 2 }, {}, 0, 0, 2, point), point.slice(0, 3));
});
