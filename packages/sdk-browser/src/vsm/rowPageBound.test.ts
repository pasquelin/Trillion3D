// The shadow raster's chunks by where the rows are (`rowPageBound.ts`), from the GPU's histograms
// (`rowBins.fixture.ts` lands them as the pass makes them): what a chunk of K rows is said to hold
// is never below what the K rows of the most pairs and commands make under the shipped cull
// (`bruteForce`) — random scenes, a camera far from the origin, objects larger than the clipmap,
// rows written and a camera moved since the histogram, a turning sun, a small cap.
import { mulberry32 } from '../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { commitMotion } from '../gpu/shadow/rowMotion.ts'
import { createVsmRowBound, vsmBoundChunk, type VsmRowBound } from './rowPageBound.ts'
import { vsmChunkRows } from './chunkKernels.ts'
import {
  bruteForce,
  emptyRowSpheres,
  PAGES,
  scene,
  sunAt,
  worstOf,
  writeRow,
  type SceneRows,
} from './rowPageBound.fixture.ts'
import { landBins, topSums } from './rowBins.fixture.ts'

type Sun = ReturnType<typeof sunAt>
const n = (rows: SceneRows) => rows.packed.length / 8
/** One frame: the bound of `rows` under `sun`, then the histogram it asks, landed at once. */
function frame(rows: SceneRows, sun: Sun, bound: VsmRowBound, cap = 1 << 21, bin = true) {
  const range = { first: 0, end: n(rows), candidates: n(rows) }
  const chunk = vsmBoundChunk(bound, rows.spheres, range, [sun.light], worstOf(cap))
  if (bin) landBins(bound, rows, range, [sun.light])
  return chunk
}

/** Asserts `chunk` over every K of `rows` under `sun`; returns it. */
function above(chunk: ReturnType<typeof frame>, rows: SceneRows, sun: Sun, cap = 1 << 21) {
  assert.ok(chunk, 'the histogram bounds the rows')
  const truth = bruteForce(rows, sun.light, PAGES)
  const pairs = topSums(truth.pairs),
    cmds = topSums(truth.cmds)
  for (let k = 1; k <= n(rows); k += Math.max(1, Math.floor(n(rows) / 97))) {
    assert.ok(chunk.pairs(k) >= pairs[k], `pairs of ${k} rows: ${chunk.pairs(k)} < ${pairs[k]}`)
    assert.ok(chunk.cmds(k) >= cmds[k], `commands of ${k} rows`)
  }
  assert.ok(chunk.pairs(chunk.rows) <= cap && chunk.cmds(chunk.rows) <= cap)
  return chunk
}

/** The bound after a first frame binned the rows. */
function holds(rows: SceneRows, sun: Sun, bound = createVsmRowBound(), cap = 1 << 21) {
  frame(rows, sun, bound, cap)
  return { chunk: above(frame(rows, sun, bound, cap), rows, sun, cap), bound }
}

test('random scenes: no K rows make more than the bound says', () => {
  for (let seed = 1; seed <= 4; seed++)
    holds(scene(1500, [0, 0, 0], 10 ** seed, 0.01, 30, seed), sunAt([0.3 * seed, 1.7, -0.2]))
})

test('far from the origin: a camera and rows at a thousand kilometres', () => {
  const far = [1.2e6, 35, -8.7e5]
  holds(scene(1500, far, 200, 0.02, 5, 7), sunAt(far.map((v) => v + 0.37)))
})

test('objects larger than the clipmap reach every page, and are bounded so', () => {
  const rows = scene(400, [0, 0, 0], 100, 0.05, 1, 3)
  writeRow(rows.packed, 0, [10, 0, 10], 5e4)
  writeRow(rows.packed, 1, [-3e5, 0, 0], 2e5)
  assert.equal(holds(rows, sunAt([0, 2, 0])).chunk.pairs(1), PAGES)
})

test('no histogram landed: the bound cannot speak, the raster keeps the worst case', () => {
  const rows = scene(500, [0, 0, 0], 50, 0.02, 1, 2)
  const sun = sunAt([0, 2, 0]),
    bound = createVsmRowBound()
  assert.equal(frame(rows, sun, bound), undefined)
  const range = { first: 0, end: 500, candidates: 500 }
  const blind = vsmChunkRows(createVsmRowBound(), emptyRowSpheres(), range, [sun.light], worstOf())
  assert.deepEqual([blind.rows, blind.pairs(blind.rows)], [worstOf().rows, worstOf().rows * PAGES])
  // Another sphere buffer than the one binned: none either.
  const other = { ...rows, spheres: emptyRowSpheres() }
  assert.equal(frame(other, sun, bound, 1 << 21, false), undefined)
})

test('rows written since the histogram, then a camera moved: still above every K', () => {
  const rows = scene(1500, [0, 0, 0], 300, 0.02, 3, 11)
  const sun = sunAt([0, 2, 0])
  const { bound } = holds(rows, sun)
  const rand = mulberry32(5),
    written = [100, 103, 120, 300, 350, 399]
  for (const i of written) writeRow(rows.packed, i, [rand() * 50, 0, rand() * 50], 2)
  // The frame counts them (`rowWords.ts`): each may now reach every page.
  commitMotion(rows.spheres.motion, written.length, 0)
  above(frame(rows, sun, bound, 1 << 21, false), rows, sun)
  above(frame(rows, sunAt([37.5, 2, -61.25], sun.cache), bound, 1 << 21, false), rows, sun)
})

test('rows past the range the histogram binned are counted whole', () => {
  const rows = scene(1200, [0, 0, 0], 80, 0.02, 3, 19)
  const sun = sunAt([0, 2, 0]),
    bound = createVsmRowBound()
  const ask = (end: number, bin = false) => {
    const range = { first: 0, end, candidates: end }
    const chunk = vsmBoundChunk(bound, rows.spheres, range, [sun.light], worstOf())
    if (bin) landBins(bound, rows, range, [sun.light])
    return chunk
  }
  ask(700, true)
  writeRow(rows.packed, 900, [0, 0, 0], 40)
  const chunk = ask(1200)!
  // The 500 rows it never binned may each reach every page.
  assert.equal(chunk.pairs(500), 500 * PAGES)
  above(chunk, rows, sun)
})

test('a turning sun keeps the worst case until a histogram of its new axes lands', () => {
  const rows = scene(500, [0, 0, 0], 50, 0.02, 1, 23)
  const sun = sunAt([0, 2, 0]),
    bound = createVsmRowBound()
  frame(rows, sun, bound)
  assert.ok(frame(rows, sun, bound, 1 << 21, false))
  sun.clipmap.lightViewRotation[0] += 1e-3
  assert.equal(frame(rows, sun, bound), undefined)
  assert.ok(frame(rows, sun, bound))
})

test('a camera travelling, a histogram landing every third frame: every frame above every K', () => {
  const rows = scene(360, [0, 0, 0], 40, 0.01, 0.2, 29)
  const first = sunAt([0, 2, 0]),
    bound = createVsmRowBound()
  frame(rows, first, bound, 1 << 16)
  for (let f = 0; f < 18; f++) {
    const moved = sunAt([3.5 * f, 2, -2.25 * f], first.cache)
    above(frame(rows, moved, bound, 1 << 16, f % 3 === 0), rows, moved, 1 << 16)
  }
})

test('a small cap: the chunk is the most rows whose bound it holds', () => {
  const cap = 40_000
  const rows = scene(1500, [0, 0, 0], 100, 0.02, 3, 13)
  const { chunk } = holds(rows, sunAt([0, 2, 0]), undefined, cap)
  assert.ok(chunk.rows < 1500 && chunk.pairs(chunk.rows + 1) > cap)
})
