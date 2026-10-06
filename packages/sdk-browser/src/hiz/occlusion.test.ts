// The rules of `hizTestRect`: which rectangles may ever be rejected, what part of them is read, and
// that the mip chosen is the finest whose outward-rounded footprint fits the test kernel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_TEST_VALUES, hizTestRect } from './occlusion.ts'
import { HIZ_KERNEL_TEXELS } from './counts.ts'
import { seededRandom } from '../../../../tests/fixtures/hiz.ts'

type Rect = [number, number, number, number]

function probe(
  [minX, minY, maxX, maxY]: Rect,
  width: number,
  height: number,
  levels: number,
  clipsNear = false,
) {
  const into = new Int32Array(HIZ_TEST_VALUES)
  const found = hizTestRect(minX, minY, maxX, maxY, clipsNear, width, height, levels, into)
  return { found, level: into[0], rect: [...into.subarray(1)] as Rect }
}

const fits = (rect: Rect, level: number) => {
  const scale = 2 ** level
  return (
    Math.floor(rect[2] / scale) - Math.floor(rect[0] / scale) < HIZ_KERNEL_TEXELS &&
    Math.floor(rect[3] / scale) - Math.floor(rect[1] / scale) < HIZ_KERNEL_TEXELS
  )
}

test('a near-plane crossing, a reversed rectangle and a zero-sized viewport are all rejected', () => {
  assert.equal(probe([0, 0, 4, 4], 64, 64, 4, true).found, false)
  assert.equal(probe([4, 4, 0, 0], 64, 64, 4).found, false)
  assert.equal(probe([0, 0, 4, 4], 0, 64, 4).found, false)
  assert.equal(probe([0, 0, 4, 4], 64, 0, 4).found, false)
  assert.equal(probe([0, 0, 4, 4], 64, 64, 0).found, false)
  assert.equal(probe([1.5, 0, 4, 4], 64, 64, 4).found, false, 'non-integer bound')
  assert.equal(probe([0, 0, NaN, 4], 64, 64, 4).found, false)
})

test('a rectangle outside the viewport is rejected, one that clips at the edge is kept and clipped', () => {
  assert.equal(probe([100, 100, 200, 200], 64, 64, 4).found, false)
  assert.equal(probe([-8, -8, -1, -1], 64, 64, 4).found, false)
  assert.equal(probe([64, 0, 70, 5], 64, 64, 4).found, false, 'first column past the edge')
  const edge = probe([-8, -8, 8, 8], 64, 64, 4)
  assert.equal(edge.found, true)
  assert.deepEqual(edge.rect, [0, 0, 8, 8])
  assert.deepEqual(probe([60, 60, 90, 90], 64, 64, 6).rect, [60, 60, 63, 63])
})

test('a generated rectangle is read over its clipped part, at the finest mip that fits the kernel', () => {
  const rand = seededRandom(23)
  let kept = 0
  for (let i = 0; i < 4000; i++) {
    const width = 1 + Math.floor(rand() * 600),
      height = 1 + Math.floor(rand() * 600),
      levels = 1 + Math.floor(rand() * 11)
    const x = Math.floor(rand() * (width + 200)) - 100,
      y = Math.floor(rand() * (height + 200)) - 100
    const input: Rect = [
      x,
      y,
      x + Math.floor(rand() * rand() * 700),
      y + Math.floor(rand() * rand() * 700),
    ]
    const got = probe(input, width, height, levels)
    const clipped: Rect = [
      Math.max(input[0], 0),
      Math.max(input[1], 0),
      Math.min(input[2], width - 1),
      Math.min(input[3], height - 1),
    ]
    const empty = clipped[2] < clipped[0] || clipped[3] < clipped[1]
    if (empty) {
      assert.equal(got.found, false, `${input} in ${width}x${height}`)
      continue
    }
    if (!got.found) {
      // Never an answer only when even the coarsest level offered is too fine for the rectangle.
      assert.equal(fits(clipped, levels - 1), false, `${input} in ${width}x${height}`)
      continue
    }
    kept++
    assert.deepEqual(got.rect, clipped)
    assert.ok(got.level >= 0 && got.level < levels)
    assert.ok(fits(clipped, got.level), 'the footprint fits the kernel')
    // Finest: no finer level fits.
    for (let finer = 0; finer < got.level; finer++)
      assert.equal(fits(clipped, finer), false, `level ${finer} already fits`)
  }
  assert.ok(kept > 1000, 'the generator keeps enough rectangles to prove something')
})

test('a span straddling every power of two selects a level that grows with it', () => {
  let previous = 0
  for (let span = 0; span <= 4096; span = span ? span * 2 : 1) {
    for (const min of [0, 1, 37]) {
      const got = probe([min, min, min + span, min + span], 8192, 8192, 14)
      assert.equal(got.found, true)
      assert.ok(fits(got.rect, got.level))
    }
    const level = probe([0, 0, span, span], 8192, 8192, 14).level
    assert.ok(level >= previous, `span ${span}`)
    previous = level
  }
})

test('a huge rectangle clamps to a small viewport, and a one-texel pyramid answers level 0', () => {
  assert.deepEqual(probe([-1e6, -1e6, 1e6, 1e6], 16, 16, 5).rect, [0, 0, 15, 15])
  const one = probe([0, 0, 0, 0], 1, 1, 1)
  assert.equal(one.found, true)
  assert.equal(one.level, 0)
  assert.deepEqual(one.rect, [0, 0, 0, 0])
})
