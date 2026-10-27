// The numbers the strands' visibility shares between the host and its shaders: the sample counts and
// positions, the least radius, the tiles and the room for the compacted samples.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HAIR_BAND_WORDS,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
  HAIR_SAMPLE_OFFSETS,
  HAIR_SAMPLE_OFFSET_STEPS,
  hairBandBytes,
  hairBandCount,
  hairBandRows,
  hairMeanSampleCount,
  hairMinRadiusAtDepth1,
  hairNodeCapacity,
  hairSampleCount,
  hairTileGrid,
  hairTileRect,
  hairUnionRect,
  writeHairBand,
} from './visibilityMath.ts'

test('a sample count is 2, 4 or 8: a value between is taken as the next one up', () => {
  assert.deepEqual([2, 3, 4, 5, 8].map(hairSampleCount), [2, 4, 4, 8, 8])
})

test('the samples of a count are distinct, inside their pixel, and as many as the count', () => {
  for (const count of [2, 4, 8] as const) {
    const offsets = HAIR_SAMPLE_OFFSETS[count]
    assert.equal(offsets.length, count)
    assert.equal(new Set(offsets.map(([x, y]) => `${x},${y}`)).size, count)
    for (const [x, y] of offsets)
      assert.ok(
        Math.abs(x) < HAIR_SAMPLE_OFFSET_STEPS / 2 && Math.abs(y) < HAIR_SAMPLE_OFFSET_STEPS / 2,
      )
  }
  // The pattern of eight puts one sample in each row and column of the eight-step grid it spans.
  const rows = HAIR_SAMPLE_OFFSETS[8].map(([, y]) => y)
  assert.equal(new Set(rows).size, 8, 'eight distinct rows')
  assert.equal(new Set(HAIR_SAMPLE_OFFSETS[8].map(([x]) => x)).size, 8, 'eight distinct columns')
})

test('the samples a pixel averages are the count times the share, one at least', () => {
  assert.equal(hairMeanSampleCount(8, 0.75), 6)
  assert.equal(hairMeanSampleCount(4, 0.75), 3)
  assert.equal(hairMeanSampleCount(2, 0.1), 1)
  assert.equal(hairMeanSampleCount(8, 4), 8, 'a share past 1 is held to it')
})

test('the least radius of a strand is half the diameter the samples cut from a pixel, times the scale', () => {
  assert.equal(hairMinRadiusAtDepth1(0.002, 8, 0.5), 0.5 * 0.5 * 0.25 * 0.002)
  assert.equal(hairMinRadiusAtDepth1(0.002, 4, 0.5), 0.5 * 0.5 * 0.5 * 0.002)
  assert.equal(hairMinRadiusAtDepth1(0.002, 2, 0.5), 0.5 * 0.5 * 0.5 * 0.002)
  assert.equal(hairMinRadiusAtDepth1(0.002, 1, 0.5), 0.5 * 0.5 * 1 * 0.002)
  assert.equal(hairMinRadiusAtDepth1(0.002, 8, 1), 0.5 * 1 * 0.25 * 0.002, 'the stable scale')
})

test('the samples are cut in bands of whole tiles of rows that fit a binding, the last the rows left', () => {
  const width = 2560,
    samples = 8,
    height = 1440
  const bytes = width * height * samples * 8
  const limit = 128 * 1024 * 1024 - 8
  assert.ok(bytes > limit, 'a 1440p image of 8 samples is past the least binding a device grants')
  const rows = hairBandRows(width, samples, limit)
  assert.equal(rows % 8, 0)
  assert.ok(rows * width * samples * 8 <= limit)
  assert.ok((rows + 8) * width * samples * 8 > limit, 'the most whole tiles of rows')
  const count = hairBandCount(height, rows)
  assert.equal(count, 2)
  let total = 0
  const words = new Uint32Array(HAIR_BAND_WORDS * count)
  for (let k = 0; k < count; k++) {
    total += hairBandBytes(k, count, rows, width, height, samples)
    writeHairBand(words, HAIR_BAND_WORDS * k, k, rows, width, height, samples)
  }
  assert.equal(total, bytes, 'the bands hold every sample, none twice')
  assert.deepEqual(Array.from(words.subarray(0, 3)), [0, rows, rows * width * samples])
  assert.deepEqual(Array.from(words.subarray(HAIR_BAND_WORDS, HAIR_BAND_WORDS + 3)), [
    rows,
    height,
    (height - rows) * width * samples,
  ])
  assert.equal(hairBandRows(width, samples, 1000), 0, 'not one tile of rows fits')
  assert.equal(hairBandCount(height, hairBandRows(width, 2, 1 << 30)), 1, 'one band where all fit')
})

test('the tiles of an image, and those that hold a rectangle of pixels', () => {
  assert.deepEqual(hairTileGrid(1920, 1080), { x: 240, y: 135, count: 32400 })
  assert.deepEqual(hairTileGrid(10, 9), { x: 2, y: 2, count: 4 })
  // The tiles from the one the first pixel lies in to the one the last lies in.
  assert.deepEqual(hairTileRect([0, 0, 0, 0], [3, 17, 9, 30]), [0, 2, 2, 4])
  assert.deepEqual(hairTileRect([0, 0, 0, 0], [8, 16, 16, 24]), [1, 2, 2, 3])
})

test('the descriptor of a pixel splits a word between the place of its samples and their count', () => {
  assert.equal(HAIR_NODE_OFFSET_MASK, 0x03ffffff)
  assert.equal(HAIR_NODE_OFFSET_BITS + 6, 32)
})

test('the room for compacted samples follows the rectangle the strands cover', () => {
  assert.equal(hairNodeCapacity([10, 20, 110, 70], 6), 100 * 50 * 6)
  assert.equal(hairNodeCapacity([0, 0, 0, 0], 6), 0)
  const rect: [number, number, number, number] = [0, 0, 0, 0]
  const group = (screenRect: [number, number, number, number], members = 1) => ({
    screenRect,
    members: Array.from({ length: members }),
  })
  assert.deepEqual(hairUnionRect(rect, []), [0, 0, 0, 0])
  assert.deepEqual(
    hairUnionRect(rect, [group([10, 10, 20, 20]), group([5, 15, 30, 18])]),
    [5, 10, 30, 20],
  )
  // A group that only casts is drawn in no pixel.
  assert.deepEqual(
    hairUnionRect(rect, [group([10, 10, 20, 20]), group([0, 0, 100, 50], 0)]),
    [10, 10, 20, 20],
  )
})
