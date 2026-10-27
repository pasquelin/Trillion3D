// The blocks the strands' passes read, as the host writes them: the view's and an instance's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT } from '../../../sdk-core/src/contracts/hairStrandsAbi.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { HAIR_IMAGE_WORDS } from './imageBlock.ts'
import { HAIR_INSTANCE_WORDS, HAIR_VIEW_WORDS } from './ribbonWgsl.ts'
import type { HairInstance } from './scene.ts'
import { writeHairInstanceBlock, writeHairViewBlock } from './visibilityBlocks.ts'

test('the blocks are as many words as the shaders declare', () => {
  // The view: a matrix, the direction and a flag, four radii, the size and its padding, the inverse matrix.
  assert.equal(HAIR_VIEW_WORDS, 16 + 4 + 4 + 2 + 2 + 16)
  // The instance: the world matrix, three axes, the offset and radius, the ids, the defaults of the
  // material, its shade and its flags.
  assert.equal(HAIR_INSTANCE_WORDS, 16 + 3 * 4 + 4 + 4 + 4 + 4 + 4)
  // The image: the size, the first tile, the room, the coverage, the nodes, the sort, the emission layer, padding.
  assert.equal(HAIR_IMAGE_WORDS, 2 + 2 + 4 + 4)
})

test('the view block holds the matrix, the direction and kind of projection, the radii and the size', () => {
  const words = wordViews(new ArrayBuffer(HAIR_VIEW_WORDS * 4))
  const matrix = Array.from({ length: 16 }, (_, i) => i + 1)
  const inverse = matrix.map((x) => -x)
  const radii = [0.25, 0.5, 1, 2] as const
  writeHairViewBlock(words, matrix, inverse, [0, 0, -1], true, radii, 640, 360, true)
  assert.deepEqual(Array.from(words.f.slice(0, 16)), matrix)
  assert.deepEqual(Array.from(words.f.slice(16, 20)), [0, 0, -1, 1])
  assert.deepEqual(Array.from(words.f.slice(20, 28)), [0.25, 0.5, 1, 2, 640, 360, 1, 0])
  assert.deepEqual(Array.from(words.f.slice(28, 44)), inverse)
  writeHairViewBlock(words, matrix, inverse, [0, 0, -1], false, radii, 640, 360, false)
  assert.equal(words.f[19], 0, 'a perspective projection')
})

test('the instance block seen from the eye: translation less the eye, unit axes, offset and radius, ids', () => {
  const words = wordViews(new ArrayBuffer(HAIR_INSTANCE_WORDS * 4))
  // Scaled by 2 on x and 3 on y, turned nothing, placed at (10, 20, 30).
  const localToWorld = Float64Array.from([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1])
  const instanceOf = (flags: number) =>
    ({
      localToWorld,
      radius: 0.01,
      group: { flags, positionOffset: [0.5, 0.25, 0.125], pointCount: 123 },
    }) as unknown as HairInstance
  writeHairInstanceBlock(
    words,
    instanceOf(HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT),
    [1, 2, 3],
    7,
    3,
    0x10,
  )
  const { f, u } = words
  assert.deepEqual(Array.from(f.slice(12, 16)), [9, 18, 27, 1])
  assert.deepEqual(Array.from(f.slice(16, 20)), [1, 0, 0, 0])
  assert.deepEqual(Array.from(f.slice(20, 24)), [0, 1, 0, 0])
  assert.deepEqual(Array.from(f.slice(24, 28)), [0, 0, 1, 0])
  assert.deepEqual(Array.from(f.slice(28, 32)), [0.5, 0.25, 0.125, 0.01].map(Math.fround))
  assert.deepEqual(Array.from(u.slice(32, 36)), [7, 123, 1, 0])
  assert.deepEqual(
    Array.from(u.slice(44, 48)),
    [0x10, 0, 1, 3],
    'flags, a word no pass reads, channels, macro group',
  )
  writeHairInstanceBlock(words, instanceOf(0), [1, 2, 3], 7, 3, 0x10)
  assert.equal(u[34], 0, 'a group not built for strips')
})
