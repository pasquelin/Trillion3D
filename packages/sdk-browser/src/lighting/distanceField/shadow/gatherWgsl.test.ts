// The sun's distance-field shadow with each group culling its own meshes: the test of a mesh against a
// group's sphere, and the depth a distance in centimetres is the device depth of, run on the shipped text.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { DFSH_GATHER_WGSL } from './gatherWgsl.ts'

test('a mesh is kept by a group where the ray from its sphere toward the light, as long as the trace, meets it', () => {
  const { dfshSegmentHitsSphere } = shaderRun<{
    dfshSegmentHitsSphere: (
      origin: number[],
      direction: number[],
      reach: number,
      centre: number[],
      radius: number,
    ) => boolean
  }>(DFSH_GATHER_WGSL, ['dfshSegmentHitsSphere'], {})
  const up = [0, 1, 0]
  const hits = (centre: number[], radius: number) =>
    dfshSegmentHitsSphere([0, 0, 0], up, 100, centre, radius)
  assert.equal(hits([5, 50, 0], 6), true, 'beside the ray, within the radius')
  assert.equal(hits([5, 50, 0], 4), false, 'beside the ray, out of the radius')
  assert.equal(hits([0, -10, 0], 5), false, 'behind the origin, out of its reach')
  assert.equal(hits([0, -10, 0], 12), true, 'behind the origin, its sphere reaches over it')
  assert.equal(hits([0, 150, 0], 10), false, 'past the end of the ray')
  assert.equal(hits([0, 150, 0], 60), true, 'past the end, its sphere reaches back over it')
})

test('a distance in centimetres is the device depth of the perspective and of the orthographic view', () => {
  const run = (depth: number[]) =>
    shaderRun<{ dfshDeviceZ: (distance: number) => number }>(DFSH_GATHER_WGSL, ['dfshDeviceZ'], {
      dfsh: { depth },
    }).dfshDeviceZ
  // Perspective: the depth is the near plane over the distance (reverse z), near 0.1 metres.
  assert.ok(Math.abs(run([0.1, 0, 1])(1000) - 0.01) < 1e-9)
  // Orthographic: 1 at the near plane, 0 at the far, between 1 and 101 metres.
  assert.ok(Math.abs(run([100, 1, 0])(5100) - 0.5) < 1e-9)
  assert.ok(Math.abs(run([100, 1, 0])(100) - 1) < 1e-9)
})
