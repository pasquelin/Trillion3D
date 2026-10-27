// The prefiltered distant shadow's separable filter (`filterableWgsl.ts`), run as the shipped text:
// the 5-tap weights, the clamp and the next page at a page's edge, the 0/1 occlusion test against
// the level's inner depth, and the 8-bit store. The runtime holds a line in workgroup memory behind
// one barrier: `runLine` loads every thread's texels, then stores the ones asked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { VSM_PAGE_TEXELS } from './constants.ts'
import { filterableWorld } from './filterableWorld.fixture.ts'

const SIDE = VSM_PAGE_TEXELS
/** The kernel's weights over 16, and a texel's byte for a filtered share `sum` / 16. */
const WEIGHTS = [1, 4, 6, 4, 1]
const byteOf = (sum: number) => Math.round((sum / 16) * 255)
const ALL = Array.from({ length: SIDE }, (_, x) => x)

/** The 5-tap sum of a line, `tap(k)` the share at position k of it, texel `x` of it. */
const sumAt = (tap: (k: number) => number, x: number) =>
  WEIGHTS.reduce((sum, w, i) => sum + w * tap(x + i - 2), 0)

/** Row 5 of the page 0 of map 0 at (64, 64), with the page 1 beside it on the right: lit at the edges
 *  of page 0, in the dark between, and the next page's first texel dark, the second lit. */
function rowWorld() {
  const w = filterableWorld()
  w.addMap(0, { range: [0.5, 1] })
  w.addPage(0, 0, [64, 64], { secondary: true })
  w.addPage(1, 0, [65, 64], { secondary: true })
  w.list('separable', [0])
  for (let x = 3; x < SIDE - 4; x++) w.setDepth(0, x, 5, 1)
  w.setDepth(1, 0, 5, 1)
  return w
}

/** The rows' share at position `k` of the line: -2.. -1 left of the page (clamped to its first texel),
 *  0..127 in it, 128.. in the next page. */
const lit = (k: number) => {
  if (k >= SIDE) return k === SIDE ? 0 : 1
  const x = Math.max(k, 0)
  return x < 3 || x >= SIDE - 4 ? 1 : 0
}

test('the filter along a row: weights 1 4 6 4 1 over 16, an edge clamped, the next page across the other', () => {
  const w = rowWorld()
  w.runLine('filterableX', [5, 0, 0], [SIDE, 1, 1], ALL)
  const temp = (x: number) => w.getByte(w.world.vsmFilterableTemp, 0, x, 5)
  // The whole row against the reference.
  for (let x = 0; x < SIDE; x++) assert.equal(temp(x), byteOf(sumAt(lit, x)), `texel ${x}`)
  // Spot values worked by hand: a lit run of five (the first texel's two taps are the clamped edge),
  // the weights of the taps lit at each side, nothing in the dark, the next page's dark texel.
  assert.equal(temp(0), 255)
  assert.equal(temp(2), byteOf(1 + 4 + 6))
  assert.equal(temp(3), byteOf(1 + 4))
  assert.equal(temp(60), 0)
  assert.equal(temp(126), byteOf(1 + 4 + 6 + 4))
  assert.equal(temp(127), byteOf(1 + 4 + 6 + 1))
})

test('a texel at the level’s inner depth is lit: the occlusion is 0 only above it', () => {
  const w = rowWorld()
  const temp = w.world.vsmFilterableTemp
  // The depth is exactly the test depth: not above it.
  w.setDepth(0, 60, 5, 0.5)
  w.runLine('filterableX', [5, 0, 0], [SIDE, 1, 1], [60])
  assert.equal(w.getByte(temp, 0, 60, 5), byteOf(6))
  // Just above it: dark (the byte is stored once, into a cleared pool).
  w.setByte(temp, 0, 60, 5, 0)
  w.setDepth(0, 60, 5, 0.5000001)
  w.runLine('filterableX', [5, 0, 0], [SIDE, 1, 1], [60])
  assert.equal(w.getByte(temp, 0, 60, 5), 0)
})

test('a page with no page mapped across an edge repeats its own edge texel', () => {
  const w = filterableWorld()
  w.addMap(0)
  w.addPage(0, 0, [64, 64], { secondary: true })
  w.list('separable', [0])
  // Only the last texel of the row is lit: the clamped taps past the edge are lit too.
  for (let x = 0; x < SIDE - 1; x++) w.setDepth(0, x, 9, 1)
  w.runLine('filterableX', [9, 0, 0], [SIDE, 1, 1], [SIDE - 3, SIDE - 1])
  const temp = (x: number) => w.getByte(w.world.vsmFilterableTemp, 0, x, 9)
  assert.equal(temp(SIDE - 1), byteOf(6 + 4 + 1))
  assert.equal(temp(SIDE - 3), byteOf(1))
})

test('the group index is flattened from x and y: the row and the page list entry follow', () => {
  const w = filterableWorld()
  w.addMap(0)
  w.addPage(7, 0, [10, 10], { secondary: true })
  w.addPage(9, 0, [20, 10], { secondary: true })
  w.list('separable', [7, 9])
  // Page 9 is the list's entry 1; its row 3 lit from the 38th texel to the 42nd.
  for (let x = 0; x < SIDE; x++) if (x < 38 || x > 42) w.setDepth(9, x, 3, 1)
  // One form of the arguments: (128, pages, 1), the page the group's y; the other: (128 · pages, 1, 1).
  w.runLine('filterableX', [3, 1, 0], [SIDE, 2, 1], [40])
  w.runLine('filterableX', [SIDE + 3, 0, 0], [2 * SIDE, 1, 1], [41])
  const temp = (page: number, x: number) => w.getByte(w.world.vsmFilterableTemp, page, x, 3)
  assert.equal(temp(9, 40), 255)
  assert.equal(temp(9, 41), byteOf(1 + 4 + 6 + 4))
  // The page 7, lit throughout, was not worked on.
  assert.equal(temp(7, 40), 0)
})

test('a byte is stored rounded to a 255th, or-ed into a cleared byte, its neighbours kept', () => {
  const w = filterableWorld()
  const { vsmFilterableTemp: temp } = w.world
  const { vsmFilterableTempPut: put } = shaderRun<{
    vsmFilterableTempPut: (b: number, x: number) => void
  }>(w.kernels.filterableX.code, ['vsmFilterableTempPut'], { ...w.consts, ...w.world })
  const { vsmFilterableTempAt: at } = shaderRun<{ vsmFilterableTempAt: (b: number) => number }>(
    w.kernels.filterableY.code,
    ['vsmFilterableTempAt'],
    { ...w.consts, ...w.world },
  )
  put(5, 0.2)
  put(6, 1 / 3)
  put(7, 1.5)
  put(4, 0.6)
  put(8, -3)
  assert.deepEqual(
    [4, 5, 6, 7, 8].map((b) => w.getByte(temp, 0, b, 0)),
    [153, 51, 85, 255, 0],
  )
  // Read back as a 255th of the byte.
  assert.equal(at(5), 51 / 255)
  assert.equal(at(7), 1)
})

/** A column of page 0 of map 0 at (64, 64) with the page 2 below it, in the temp pool, the history off. */
function columnWorld(column: (y: number) => number, below: (y: number) => number) {
  const w = filterableWorld()
  w.addMap(0)
  w.addPage(0, 0, [64, 64], { secondary: true })
  w.addPage(2, 0, [64, 65], { secondary: true })
  w.list('separable', [0])
  for (let y = 0; y < SIDE; y++) {
    w.setByte(w.world.vsmFilterableTemp, 0, 7, y, column(y))
    w.setByte(w.world.vsmFilterableTemp, 2, 7, y, below(y))
  }
  return w
}

test('the filter down a column: the page below across the bottom edge, the first texel repeated at the top', () => {
  const w = columnWorld(
    (y) => (y >= SIDE - 3 ? 255 : y === 0 ? 255 : 0),
    (y) => (y === 0 ? 255 : 0),
  )
  w.runLine('filterableY', [7, 0, 0], [SIDE, 1, 1], [0, 1, 2, SIDE - 3, SIDE - 2, SIDE - 1])
  const out = (y: number) => w.getByte(w.world.vsmFilterableSeparate, 0, 7 + 1, y + 1)
  // The bottom texel: its own three lit (1 4 6), the next page's first row lit (4), its second dark.
  assert.equal(out(SIDE - 1), byteOf(1 + 4 + 6 + 4))
  assert.equal(out(SIDE - 2), byteOf(4 + 6 + 4 + 1))
  assert.equal(out(SIDE - 3), byteOf(6 + 4 + 1))
  // The top: the first texel lit and repeated above the page (1 4 at -2 -1) beside its own (6).
  assert.equal(out(0), byteOf(1 + 4 + 6))
  assert.equal(out(1), byteOf(1 + 4))
  assert.equal(out(2), byteOf(1))
})
