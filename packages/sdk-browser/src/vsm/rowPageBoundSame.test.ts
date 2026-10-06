// The chunk bound's answer, number for number, over random scenes and a travelling camera: what a
// chunk of K rows is said to hold (`VsmChunk.pairs`, `cmds`) for every K, and the rows a chunk
// takes. The digest was taken on the bound that read each bin's levels one by one and sorted the
// bins by weight with a comparator; a bin's levels from the level order's prefix sums and the bins
// in an integer-keyed order leave every number the same (their weights and pages are integers:
// summed in any order, they are the same doubles, and equal weights take the same share of a top).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createVsmRowBound, vsmBoundChunk } from './rowPageBound.ts'
import { seeded, sphereRows, sunAt, worstOf } from './rowPageBound.fixture.ts'

const DIGEST = '6cd174a2d006703f8dc51a3299621af41011014cb049a4289708fbd60e7f6323'

test('the bound answers the same numbers, every K, every frame', () => {
  const hash = createHash('sha256')
  for (let seed = 1; seed <= 4; seed++) {
    const rand = seeded(seed)
    const n = 600 + seed * 150
    // Rows small beside the levels, spread from a few metres to a kilometre: the bins beat the
    // worst case, by little or by much.
    const rows = sphereRows(
      n,
      () => [0, 1, 2].map(() => (rand() * 2 - 1) * 5 * 4 ** seed),
      () => 0.01 * 40 ** rand(),
    )
    const bound = createVsmRowBound()
    const first = sunAt([0, 2, 0])
    for (let f = 0; f < 12; f++) {
      const sun = f ? sunAt([1.75 * f, 2, -1.25 * f], first.cache) : first
      const worst = worstOf(1 << (15 + (f % 4)))
      // Each place held three frames: first sight, the bins made, then read.
      let chunk
      for (let held = 0; held < 3; held++)
        chunk = vsmBoundChunk(bound, rows, { first: 0, end: n, candidates: n }, [sun.light], worst)
      if (!chunk) {
        hash.update('none;')
        continue
      }
      const numbers = [chunk.rows]
      for (let k = 1; k <= n; k += 1 + (k >> 3)) numbers.push(chunk.pairs(k), chunk.cmds(k))
      hash.update(numbers.join(',') + ';')
    }
  }
  assert.equal(hash.digest('hex'), DIGEST)
})
