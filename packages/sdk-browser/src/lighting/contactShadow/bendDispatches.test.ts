// The dispatches of the screen-space shadow march: the four quadrants about the light's pixel, cut on their longer side.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BEND_MAX_DISPATCHES, BEND_WAVE, bendDispatchList } from './bendDispatches.ts'

/** A point light at the clip position of pixel (`x`, `y`) of a 512 x 512 view. */
const at = (x: number, y: number, w = 1) =>
  [((x / 512) * 2 - 1) * w, (1 - (y / 512) * 2) * w, 0.5 * w, w] as const

test('a light is given by its pixel, its depth and whether it is in front of the eye', () => {
  const front = bendDispatchList(at(100, 200), [512, 512], [0, 0], [511, 511])
  assert.deepEqual(
    front.light.map((v) => Math.round(v * 1000) / 1000),
    [100, 200, 0.5, 1],
  )
  const behind = bendDispatchList([0.2, 0.1, 0.5, -1], [512, 512], [0, 0], [511, 511])
  assert.equal(behind.light[3], -1)
  // A sun is a direction: w 0, and its depth is none.
  const sun = bendDispatchList([0.3, 0.3, 0.5, 0], [512, 512], [0, 0], [511, 511])
  assert.equal(sun.light[2], 0)
  assert.equal(sun.light[3], -1)
})

test('a light on the screen has up to eight dispatches of whole waves, each a wave of threads along x', () => {
  const list = bendDispatchList(at(256, 256), [512, 512], [0, 0], [511, 511])
  assert.ok(list.dispatches.length > 0 && list.dispatches.length <= BEND_MAX_DISPATCHES)
  for (const d of list.dispatches) {
    assert.equal(d.groups[0], BEND_WAVE)
    assert.ok(d.groups[1] > 0 && d.groups[2] > 0)
    assert.ok(
      d.offset.every((o) => o % BEND_WAVE === 0),
      'offsets are in whole waves',
    )
  }
})

test('the waves cover every pixel of the rectangle the light reaches', () => {
  // The wavefronts of a dispatch lie on rings about the light: the tiles of the quadrant, so their area is at least the rectangle's.
  const size = 512
  const list = bendDispatchList(at(300, 100), [size, size], [0, 0], [size - 1, size - 1])
  const area = list.dispatches.reduce((sum, d) => sum + d.groups[1] * d.groups[2], 0)
  assert.ok(area * BEND_WAVE * BEND_WAVE >= size * size)
})

test('a light far off the screen has a few dispatches', () => {
  const far = bendDispatchList(at(-4000, 256), [512, 512], [0, 0], [511, 511])
  assert.ok(far.dispatches.length > 0 && far.dispatches.length <= BEND_MAX_DISPATCHES)
})
