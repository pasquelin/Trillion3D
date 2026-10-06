// The shadow raster's chunks by where the rows are (`rowPageBound.ts`): what a chunk of K rows is
// said to hold is never below what the K rows of the most pairs and commands make under the
// shipped cull (`bruteForce`) — random scenes, a camera far from the origin, objects larger than
// the clipmap, a camera moved without re-binning, rows written and a range grown or shrunk.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createVsmRowBound,
  vsmBoundChunk,
  type VsmRowBound,
  type VsmRowSpheres,
} from './rowPageBound.ts'
import { vsmChunkRows } from './renderPass.ts'
import {
  bruteForce,
  emptyRowSpheres,
  PAGES,
  scene,
  seeded,
  sunAt,
  topSums,
  worstOf,
  writeRow,
} from './rowPageBound.fixture.ts'

type Sun = ReturnType<typeof sunAt>
/** The bound of `rows` under `sun`, its first sight held still a frame (a sun seen once turns). */
function chunkOf(rows: VsmRowSpheres, sun: Sun, bound: VsmRowBound, cap: number, n = 0) {
  const end = n || rows.packed.length / 8
  const range = { first: 0, end, candidates: end }
  const ask = () => vsmBoundChunk(bound, rows, range, [sun.light], worstOf(cap))
  // First sight, then bins made a slice a frame.
  let chunk = ask()
  for (let f = 0; !chunk && f < 64; f++) chunk = ask()
  return chunk!
}

/** Asserts the bound over every K of the first `n` of `rows` (all at 0) under `sun`; returns its
 *  chunk. */
function holds(rows: VsmRowSpheres, sun: Sun, bound = createVsmRowBound(), cap = 1 << 21, n = 0) {
  const chunk = chunkOf(rows, sun, bound, cap, n)
  const truth = bruteForce(rows, sun.light, PAGES)
  n ||= truth.pairs.length
  const pairs = topSums(truth.pairs.subarray(0, n)),
    cmds = topSums(truth.cmds.subarray(0, n))
  for (let k = 1; k <= n; k += Math.max(1, Math.floor(n / 97))) {
    assert.ok(chunk.pairs(k) >= pairs[k], `pairs of ${k} rows: ${chunk.pairs(k)} < ${pairs[k]}`)
    assert.ok(chunk.cmds(k) >= cmds[k], `commands of ${k} rows`)
  }
  assert.ok(chunk.pairs(chunk.rows) <= cap && chunk.cmds(chunk.rows) <= cap)
  return { chunk, bound }
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

test('rows written, then a camera moved without re-binning: still above every K', () => {
  const rows = scene(1500, [0, 0, 0], 300, 0.02, 3, 11)
  const sun = sunAt([0, 2, 0])
  const { bound } = holds(rows, sun)
  const rand = seeded(5)
  for (const i of [100, 103, 120, 300, 350, 399])
    writeRow(rows.packed, i, [rand() * 50, 0, rand() * 50], 2)
  rows.written = { epoch: 1, runs: [100, 120, 300, 399] }
  holds(rows, sun, bound)
  // The bins followed the written runs: the same as binning every row anew.
  const fresh = createVsmRowBound()
  chunkOf(rows, sun, fresh, 1 << 21)
  assert.deepEqual(
    bound.suns[0].held[bound.suns[0].now].counts,
    fresh.suns[0].held[fresh.suns[0].now].counts,
  )
  bound.binnedChunks = Infinity
  holds(rows, sunAt([37.5, 2, -61.25], sun.cache), bound)
})

test('a range that shrinks then grows bins as a fresh bound does', () => {
  const rows = scene(1200, [0, 0, 0], 80, 0.02, 3, 19)
  const sun = sunAt([0, 2, 0])
  const bound = createVsmRowBound()
  for (const n of [1200, 700, 1000]) {
    chunkOf(rows, sun, bound, 1 << 21, n)
    const fresh = createVsmRowBound()
    chunkOf(rows, sun, fresh, 1 << 21, n)
    assert.deepEqual(
      bound.suns[0].held[bound.suns[0].now].counts,
      fresh.suns[0].held[fresh.suns[0].now].counts,
      `${n} rows`,
    )
  }
})

test('a turning sun keeps the worst case; still a frame, it is binned', () => {
  const rows = scene(500, [0, 0, 0], 50, 0.02, 1, 23)
  const bound = createVsmRowBound()
  const range = { first: 0, end: 500, candidates: 500 }
  const { light, clipmap } = sunAt([0, 2, 0])
  const ask = () => vsmBoundChunk(bound, rows, range, [light], worstOf())
  // First sight, then still: binned.
  assert.deepEqual([ask(), !!ask()], [undefined, true])
  // Its axes moved since the frame before: the worst case, then binned once they hold.
  clipmap.lightViewRotation[0] += 1e-3
  assert.deepEqual([ask(), !!ask(), !!ask()], [undefined, true, true])
})

test('a camera travelling, its bins re-made a slice a frame: every frame above every K', () => {
  const rows = scene(360, [0, 0, 0], 40, 0.01, 0.2, 29)
  const cap = 1 << 16,
    first = sunAt([0, 2, 0])
  const bound = Object.assign(createVsmRowBound(), { slice: 100 })
  let n = 360,
    sliced = 0,
    replaced = 0,
    from = [0, 0, 0]
  for (let f = 0; f < 18; f++) {
    const moved = sunAt([3.5 * f, 2, -2.25 * f], first.cache)
    if (f === 5) {
      writeRow(rows.packed, 40, [3.5 * f, 0, -2.25 * f], 1.5)
      rows.written = { epoch: rows.written.epoch + 1, runs: [40, 40] }
    }
    // Rows written and the range moved before the slicing and while it runs.
    if (f === 12) {
      writeRow(rows.packed, 40, [3.5 * f, 0, -2.25 * f], 0.4)
      writeRow(rows.packed, 330, [3.5 * f + 1, 0, -2.25 * f], 0.4)
      rows.written = { epoch: rows.written.epoch + 1, runs: [40, 40, 330, 330] }
    }
    if (f === 7) n = 250
    if (f === 10 || f === 15) n = 360
    if (f === 13) n = 300
    const eye = [3.5 * f, 2, -2.25 * f]
    const making = !!bound.suns[0]?.making
    holds(rows, moved, bound, cap, n)
    const sun = bound.suns[0]
    if (sun.making) {
      if (!making) from = eye
      sliced++
    } else if (making) {
      // The bins made over those frames are those of a bound binned at once where they began.
      replaced++
      const fresh = createVsmRowBound()
      chunkOf(rows, sunAt(from), fresh, cap, n)
      const counts = (b: typeof bound) => b.suns[0].held[b.suns[0].now].counts
      assert.deepEqual(counts(bound), counts(fresh), `frame ${f}: the bins made`)
    }
  }
  assert.ok(sliced > 1 && replaced > 0, 'bins re-made over several frames, then taken')
})

test('a small cap: the chunk is the most rows whose bound it holds', () => {
  const cap = 40_000
  const { chunk } = holds(
    scene(1500, [0, 0, 0], 100, 0.02, 3, 13),
    sunAt([0, 2, 0]),
    undefined,
    cap,
  )
  assert.ok(chunk.rows < 1500 && chunk.pairs(chunk.rows + 1) > cap)
})

test('the raster takes the bound, or the worst case where the spheres fall short', () => {
  const rows = scene(30_000, [0, 0, 0], 25, 0.03, 0.08, 17)
  const { light } = sunAt([0, 1.7, 0])
  const range = { first: 0, end: 30_000, candidates: 30_000 }
  const worst = worstOf()
  const bound = createVsmRowBound()
  // First sight, then its bins made a slice a frame (two slices).
  for (let f = 0; f < 3; f++) vsmChunkRows(bound, rows, range, [light], worst)
  const known = vsmChunkRows(bound, rows, range, [light], worst)
  assert.ok(known.rows > worst.rows && known.pairs(known.rows) <= worst.cap)
  const blind = vsmChunkRows(createVsmRowBound(), emptyRowSpheres(), range, [light], worst)
  assert.deepEqual([blind.rows, blind.pairs(blind.rows)], [worst.rows, worst.rows * PAGES])
})
