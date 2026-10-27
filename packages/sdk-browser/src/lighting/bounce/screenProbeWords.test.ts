// The words the screen probes pack: the frames byte, the shading word and the bent normal word.

import test from 'node:test'
import assert from 'node:assert/strict'
import { SP_BENT_WGSL, spHistory } from './screen/historyWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'

test('the frames byte keeps the fast update and the frames as it packs them, and only none is none', () => {
  const longest = 10
  const frames = shaderRun<{
    spFramesOf: (frames: number, fast: number) => number
    spFramesHeld: (code: number) => number
    spFastHeld: (code: number) => number
  }>(wgslModule(spHistory(9, 10, 8)), ['spFramesOf', 'spFramesHeld', 'spFastHeld'], {
    sp: { counts: [longest, 0, 0, 0] },
  })
  for (const held of [0, 1, 4, 9.5, 10]) {
    const code = frames.spFramesOf(held, 0)
    assert.ok(code < 256, 'one byte')
    assert.ok(Math.abs(frames.spFramesHeld(code) - held) <= longest / 30 + 1e-9, `${held} frames`)
    assert.equal(frames.spFastHeld(code), 0)
  }
  assert.equal(frames.spFramesHeld(frames.spFramesOf(longest, 0)), longest, 'the most is the most')
  assert.equal(frames.spFramesHeld(frames.spFramesOf(3 * longest, 0)), longest, 'held to it')
  assert.equal(
    frames.spFastHeld(frames.spFramesOf(5, 0.001)),
    1 / 15,
    'a fast update, however small, is one',
  )
  assert.equal(frames.spFastHeld(frames.spFramesOf(5, 0.9)), 14 / 15)
  assert.equal(frames.spFastHeld(frames.spFramesOf(5, 2)), 1, 'held to one')
  assert.equal(
    frames.spFramesHeld(frames.spFramesOf(5, 1)),
    frames.spFramesHeld(frames.spFramesOf(5, 0)),
    'the fast update leaves the frames alone',
  )
  const fifteen = shaderRun<typeof frames>(
    wgslModule(spHistory(9, 10, 8)),
    ['spFramesOf', 'spFramesHeld'],
    {
      sp: { counts: [15, 0, 0, 0] },
    },
  )
  assert.equal(
    fifteen.spFramesHeld(fifteen.spFramesOf(14, 0)),
    14,
    'fourteen of fifteen stay fourteen',
  )
  // A longest history past the four bits: the frames are coded over fifteen at most, and the code 15 is the longest, whatever it is.
  const wide = shaderRun<typeof frames>(
    wgslModule(spHistory(9, 10, 8)),
    ['spFramesOf', 'spFramesHeld'],
    {
      sp: { counts: [40, 0, 0, 0] },
    },
  )
  assert.equal(wide.spFramesHeld(wide.spFramesOf(14, 0)), 14)
  assert.equal(wide.spFramesHeld(wide.spFramesOf(15, 0)), 40, 'fifteen frames code the most')
  assert.equal(wide.spFramesHeld(wide.spFramesOf(40, 0)), 40)
})

test('the shading word keeps the normal in 10-10-10 bits and whether the pixel has backface diffuse light in the two above, and its depth is a texture of its own, as the float it is', () => {
  const shading = shaderRun<{
    spShadingPack: (N: number[], foliage: boolean) => number
    spShadingNormal: (word: number) => number[]
    spShadingFoliage: (word: number) => boolean
    spKeptDepth: (texel: number[]) => number
  }>(
    wgslModule(spHistory(9, 10, 8)),
    ['spShadingPack', 'spShadingNormal', 'spShadingFoliage', 'spKeptDepth'],
    { depthIn: {}, textureLoad: (_texture: unknown, texel: number[]) => [texel[0] / 4, 0, 0, 0] },
  )
  for (const v of [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [0.3, -0.5, 0.8],
    [-1, -1, -1],
    [0.2, 0.9, -0.1],
  ]) {
    const length = Math.hypot(...v)
    const normal = v.map((x) => x / length)
    for (const foliage of [false, true]) {
      const word = shading.spShadingPack(normal, foliage)
      // The normal is `n · ½ + ½` rounded to a thousand and twenty-four steps an axis: a half step either way of the unit.
      const kept = shading.spShadingNormal(word)
      normal.forEach((x, i) =>
        assert.ok(Math.abs(kept[i] - x) <= 1 / 1023 + 1e-6, `${v} axis ${i}`),
      )
      assert.equal(shading.spShadingFoliage(word), foliage, `${v} foliage`)
    }
    assert.equal(
      shading.spShadingNormal(shading.spShadingPack(normal, true)).join(),
      shading.spShadingNormal(shading.spShadingPack(normal, false)).join(),
      'the mark leaves the normal alone',
    )
  }
  assert.equal(shading.spKeptDepth([1, 0]), 0.25, 'the depth texture’s red is the depth')
  assert.equal(shading.spKeptDepth([0, 0]), 0, 'a texel that kept no surface keeps none')
})

test('the bent normal word keeps the open sky’s direction and its amount, and a word of zero is none', () => {
  const bent = shaderRun<{
    spBentPack: (v: number[]) => number
    spBentUnpack: (word: number) => number[]
  }>(wgslModule(SP_BENT_WGSL), ['spBentPack', 'spBentUnpack'], {})
  for (const v of [
    [0, 1, 0],
    [0.3, 0.4, -0.5],
    [-0.1, -0.2, 0.05],
  ]) {
    const amount = Math.hypot(...v)
    const [x, y, z, w] = bent.spBentUnpack(bent.spBentPack(v))
    assert.ok(Math.abs(w - amount) < 2e-3, `the amount ${amount}`)
    for (const [got, want] of [
      [x, v[0] / amount],
      [y, v[1] / amount],
      [z, v[2] / amount],
    ])
      assert.ok(Math.abs(got - want) < 5e-3, `the direction ${v}`)
  }
})
