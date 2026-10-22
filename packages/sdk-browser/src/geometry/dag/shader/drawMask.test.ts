// `dagDrawScatter` ranks a drawn page in its block off the block's two draw-mask words, which
// `dagMask` sets with the draw flag: the rank must be the sum of the block's flags before the page,
// the walk it replaces, on every flag pattern. The mask words' place in `work` must be the one
// `dagWorkLayout` allocates, with no word per page in `work`. The kernel's own functions run in
// Node (`wgslScope`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { dagWorkLayout } from './floorWgsl.ts'
import { wgslScope } from '../../cut/wgslPredicate.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { DAG_VIEW_FILTER_WGSL } from './viewFilterWgsl.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'

const countOneBits = (word: number) => {
  let n = 0
  for (let w = word >>> 0; w; w &= w - 1) n++
  return n
}

function kernel(clusterCount: number) {
  const scope = wgslScope(DAG_SELECTION_SHADER, {
    ...wgslConstants(DAG_SELECTION_SHADER),
    views: [{ clusterCount }],
    countOneBits,
  })
  const fn = (name: string) => scope.fn(name) as (...args: number[]) => number
  return {
    blockCount: fn('blockCount')(),
    drawMaskBase: fn('drawMaskBase')(),
    liveCounter: fn('liveCounter')(),
    word: fn('drawMaskWord'),
    bit: fn('drawBit'),
    before: fn('drawnBefore'),
  }
}

/** `dagMask` then `dagDrawScatter` on `flags`: each drawn page's rank in its block. */
function maskRanks(flags: Uint8Array) {
  const k = kernel(flags.length),
    work = new Uint32Array(k.liveCounter)
  flags.forEach((f, i) => f && (work[k.word(i)] |= k.bit(i)))
  const ranks = new Map<number, number>()
  flags.forEach((f, i) => {
    if (!f) return
    const word = k.word(i)
    let rank = k.before(i, work[word])
    if (i & 32) rank += countOneBits(work[word - 1])
    ranks.set(i, rank)
  })
  return ranks
}

/** The walk the masks replace: the flags of the block before the page. */
function walkRanks(flags: Uint8Array) {
  const ranks = new Map<number, number>()
  flags.forEach((f, i) => {
    if (!f) return
    let rank = 0
    for (let j = i - (i % 64); j < i; j++) rank += flags[j]
    ranks.set(i, rank)
  })
  return ranks
}

test('the mask rank is the walked rank, on every density and block edge', () => {
  const next = lcgRandom(922)
  for (const count of [1, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1000])
    for (const density of [0, 0.03, 0.5, 0.97, 1]) {
      const flags = Uint8Array.from({ length: count }, () => (next() < density ? 1 : 0))
      assert.deepEqual(maskRanks(flags), walkRanks(flags), `${count} pages at ${density}`)
    }
})

test('the mask sits between the block offsets and the counters the layout allocates', () => {
  for (const count of [1, 64, 65, 4096, 100_000]) {
    const k = kernel(count),
      layout = dagWorkLayout(k.blockCount)
    assert.equal(k.drawMaskBase, 2 * k.blockCount, 'behind the counts and offsets')
    for (let b = 0; b < k.blockCount; b++) {
      assert.equal(k.word(b * 64), k.drawMaskBase + 2 * b, `block ${b}, first half`)
      assert.equal(k.word(b * 64 + 32), k.drawMaskBase + 2 * b + 1, `block ${b}, second half`)
    }
    // The mask the cut writes, two words per block, the frame's behind it, the post pass's behind
    // that, then the counters: no word per page in `work`.
    assert.equal(layout.drawMask, k.drawMaskBase + 2 * k.blockCount, 'then the frame’s')
    assert.equal(layout.postMask, k.drawMaskBase + 4 * k.blockCount, 'then the post pass’s')
    assert.equal(k.liveCounter, k.drawMaskBase + 6 * k.blockCount, 'then the counters')
    assert.equal(layout.liveCounter, k.liveCounter, 'the layout the engine allocates')
  }
})

test('the filter is a bit a placement in the region behind the counters, none where the block names none', () => {
  // The region the layout allocates for the placements the cut holds, behind the group counts.
  for (const placements of [0, 1, 32, 33, 1000]) {
    const layout = dagWorkLayout(4, placements)
    assert.equal(layout.filter, dagWorkLayout(4).words, 'behind every other word of work')
    assert.equal(layout.words - layout.filter, Math.ceil(placements / 32))
  }
  const work = new Array<number>(40).fill(0),
    view = { filterBase: 0 }
  work[10] = 0b101
  work[11] = 1 << 31
  const run = shaderRun<{ filteredOut(w: number): boolean }>(
    DAG_VIEW_FILTER_WGSL,
    ['filteredOut'],
    {
      views: [view],
      work,
    },
  )
  assert.equal(run.filteredOut(0), false, 'no region: nothing is filtered')
  view.filterBase = 10
  const at = (...placements: number[]) => placements.map((w) => run.filteredOut(w))
  assert.deepEqual(at(0, 1, 2, 3), [true, false, true, false])
  assert.deepEqual(at(31, 32, 63, 64), [false, false, true, false])
  assert.ok(DAG_SELECTION_SHADER.includes('atomicLoad(&work[base+(w>>5u)])'))
})
