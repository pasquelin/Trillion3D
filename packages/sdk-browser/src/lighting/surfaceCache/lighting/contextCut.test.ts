// The pages of the bucket the budget ends in are taken in the order of their index, however the threads arrive in: the cut is found from the tiles by block of indices
// (`contextHistogram`), then in the one block the tiles left run out in (`contextCut`), and the pages taken are those before it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { CONTEXT_ENTRIES, CONTEXT_WGSL } from './contextWgsl.ts'
import { CONTEXT_AT, CONTEXT_HEADER_WORDS, CUT_BLOCKS, CUT_NONE } from './layout.ts'
import { PRIORITY_HISTOGRAM_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'

/** The pages (by index) taken in the order of their index while their tiles, counted whether or not they fit, stay within `left`: the law. */
const byIndex = (tiles: readonly number[], left: number) => {
  let sum = 0
  return tiles.map((t) => t > 0 && (sum += t) <= left)
}

/** The bits a page index is shifted right by to give its block (`cutShift`). */
const shiftOf = (pages: number) => {
  let shift = 0
  while (1 << shift < Math.ceil(pages / CUT_BLOCKS)) shift++
  return shift
}

/** The cut as the program finds it: the blocks' totals, the block the tiles left run out in, the first page of it that does not fit. */
function cutOf(tiles: readonly number[], left: number) {
  const shift = shiftOf(tiles.length)
  const blocks = new Array<number>(CUT_BLOCKS).fill(0)
  tiles.forEach((t, page) => (blocks[page >> shift] += t))
  let before = 0
  for (let b = 0; b < CUT_BLOCKS; b++) {
    if (before + blocks[b] > left) {
      let running = before
      for (let page = b << shift; page < Math.min((b + 1) << shift, tiles.length); page++) {
        running += tiles[page]
        if (tiles[page] > 0 && running > left) return page
      }
    }
    before += blocks[b]
  }
  return CUT_NONE
}

const admitted = (tiles: readonly number[], left: number) => {
  const cut = cutOf(tiles, left)
  return tiles.map((t, page) => t > 0 && page < cut)
}

test('the cut admits the pages of the bucket by index, as many as the tiles left allow, whatever the sizes and the budget', () => {
  let seed = 12345
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
  for (let trial = 0; trial < 400; trial++) {
    const pages = 1 + Math.floor(next() * 5000)
    const tiles = Array.from({ length: pages }, () =>
      next() < 0.4 ? 0 : 1 + Math.floor(next() * 16),
    )
    const total = tiles.reduce((a, b) => a + b, 0)
    const left = Math.floor(next() * (total + 4))
    assert.deepEqual(
      admitted(tiles, left),
      byIndex(tiles, left),
      `${pages} pages, ${left} tiles left`,
    )
  }
})

test('the pages that fit are those before the first that does not: the result does not depend on an order of arrival', () => {
  const tiles = [3, 5, 2, 8, 1, 4, 4, 6]
  const left = 11
  const expected = byIndex(tiles, left)
  assert.deepEqual(expected, [true, true, true, false, false, false, false, false])
  for (let shift = 0; shift < tiles.length; shift++) {
    const order = tiles.map((_, i) => (i + shift) % tiles.length)
    const taken = new Array<boolean>(tiles.length).fill(false)
    const cut = cutOf(tiles, left)
    for (const page of order) taken[page] = tiles[page] > 0 && page < cut
    assert.deepEqual(taken, expected)
  }
})

test('every page fits where the bucket’s tiles are within the budget: no cut', () => {
  assert.equal(cutOf([2, 3, 4], 9), CUT_NONE)
  assert.equal(cutOf([2, 3, 4], 8), 2)
  assert.equal(cutOf([5, 3], 0), 0)
})

test('the program carries the cut: it assembles, the header holds its words, and the listing no longer counts the bucket in arrival order', () => {
  for (const entry of CONTEXT_ENTRIES) assertProgramAssembles(CONTEXT_WGSL, entry)
  assert.ok(CONTEXT_ENTRIES.includes('contextCut'))
  assert.equal(CONTEXT_AT.cut, CONTEXT_AT.blockHistogram + 2 * CUT_BLOCKS * PRIORITY_HISTOGRAM_SIZE)
  assert.ok(CONTEXT_AT.cut + 2 <= CONTEXT_HEADER_WORDS)
  assert.match(CONTEXT_WGSL, /page<atomicLoad\(&ctx\[CTX_CUT\+c\]\)/)
  assert.doesNotMatch(CONTEXT_WGSL, /CTX_ALLOCATED\+c\*2u\+1u/)
  // One rule of bucket: the histogram the budget is cut from, the blocks' and the listing take the page's listed bucket.
  assert.match(
    CONTEXT_WGSL,
    /let bucket=listedBucket\(page,c,speed\);\n  atomicAdd\(&ctx\[CTX_HISTOGRAM\+c\*BUCKETS\+bucket\],tiles\)/,
  )
  assert.doesNotMatch(CONTEXT_WGSL, /priorityBucket\(scPageW\(page,PAGE_LAST_UPDATE\+c\),speed\)/)
  assert.doesNotMatch(CONTEXT_WGSL, /contextCutHistogram|contextCutSelect/)
})
