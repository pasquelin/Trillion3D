import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_UNIT_PER_CM } from '../vsm/constants.ts'
import { cascadeSphere } from './cascadeSplits.ts'
import { DENSE_ENTRY_WORDS, writeDenseEntries } from './denseEntries.ts'
import { localMip, sunLevelIndex } from './denseLevels.ts'

test("a cascade's sphere reaches its farthest corner, at least a centimetre, its centre held between its planes", () => {
  const s = cascadeSphere(100, 1000, 1, 0.5)
  assert.ok(s.depth >= 100 && s.depth <= 1000)
  const far = Math.hypot(1000, 500, 1000 - s.depth)
  const near = Math.hypot(100, 50, s.depth - 100)
  assert.ok(Math.abs(s.radius - Math.max(far, near)) < 1e-6)
  assert.equal(cascadeSphere(0, 0.0001, 0, 0).radius, 1)
})

test('a cascade takes the level whose texels are the nearest at or above those of its resolution, held to the levels there are', () => {
  // A sphere of 2^13 cm radius at 2048 texels: 2^14 cm over 2048 texels is 8 cm, a level of absolute 2^a with 2^(a+2)/16384 >= 8 → a = 15.
  assert.equal(sunLevelIndex(2 ** 13, 2048, 6, 40), 15 - 6)
  assert.equal(sunLevelIndex(2 ** 13, 2048, 6, 5), 4)
  assert.equal(sunLevelIndex(1, 2048, 6, 40), 0)
})

test("a local light's map is the mip whose texels are the nearest at or under its resolution", () => {
  assert.equal(localMip(16384), 0)
  assert.equal(localMip(2048), 3)
  assert.equal(localMip(1500), 4)
  assert.equal(localMip(1), 7)
})

test('the entries hold each cascade of a sun and each face of a local light, in the world units', () => {
  const buffer = new ArrayBuffer(DENSE_ENTRY_WORDS * 4 * 64)
  const words = new Uint32Array(buffer)
  const floats = new Float32Array(buffer)
  const camera = { perspective: true, forward: [0, 0, -1], tanX: 1, tanY: 0.5 }
  const view = { distanceScale: 1, maxCascades: 10, transitionScale: 1, near: 10 }
  const count = writeDenseEntries(
    words,
    floats,
    [{ firstId: 8192, firstLevel: 6, levelCount: 30 }],
    [{ firstId: 3, mapCount: 6, resolution: 2048 }],
    camera,
    view,
    2048,
  )
  assert.equal(count, 4 + 6)
  assert.equal(words[4], 8192 + sunLevelIndex(floats[3]! / VSM_UNIT_PER_CM, 2048, 6, 30))
  assert.ok(floats[2]! < 0, 'the centre lies ahead of the eye')
  assert.equal(words[4 * DENSE_ENTRY_WORDS + 4], 3)
  assert.equal(words[4 * DENSE_ENTRY_WORDS + 5], 3)
  // An orthographic view draws no cascade.
  assert.equal(
    writeDenseEntries(
      words,
      floats,
      [{ firstId: 0, firstLevel: 0, levelCount: 3 }],
      [],
      { ...camera, perspective: false },
      view,
      2048,
    ),
    0,
  )
})
