// The two by two downsample's shared maths: the pixel of a block a texel stands for, and the texel a pixel is counted from.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { downsampleBase, fourRooksJitter } from '../../../../math/src/wgsl/sampling.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

test('a texel stands for the pixel of its block that the four-rooks pattern names: the four texels of a block take four different pixels in one image, one texel all four over four frames', () => {
  const { fourRooksJitter: jitter } = shaderRun<{
    fourRooksJitter: (cell: number[], frame: number) => number[]
  }>(wgslModule(fourRooksJitter), ['fourRooksJitter'], {})
  assert.deepEqual(
    [0, 1, 2, 3].map((frame) => jitter([0, 0], frame)),
    [
      [0, 1],
      [0, 0],
      [1, 1],
      [1, 0],
    ],
  )
  const cells = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]
  for (let frame = 0; frame < 4; frame++) {
    assert.equal(new Set(cells.map((cell) => String(jitter(cell, frame)))).size, 4)
    // The pattern repeats from block to block.
    assert.deepEqual(jitter([4, 6], frame), jitter([0, 0], frame))
  }
})

test('the texel a pixel is counted from is the last one whose centre lies at or before the pixel’s, the texel before the first at the first row and column', () => {
  const { downsampleBase: base } = shaderRun<{
    downsampleBase: (pixel: number[], factor: number) => number[]
  }>(wgslModule(downsampleBase), ['downsampleBase'], {})
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((x) => base([x, 0], 2)[0]),
    [-1, 0, 0, 1, 1],
  )
  assert.deepEqual(base([5, 7], 2), [2, 3])
})
