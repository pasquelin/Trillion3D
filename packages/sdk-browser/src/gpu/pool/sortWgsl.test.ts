// The shipped pool sort (`sortWgsl.ts`) is stable: within a rank the lower slot first, whatever
// order its workgroups and lanes run in. Two runs over the same slots, their threads shuffled
// apart, give the same queue — the mirror's (`sort.fixture.ts`) —, under the burst and past it.
// Fails on the old sort: each slot took its rank's next place by an atomic add, in the order the
// threads arrived, so two fresh identical worlds could list their victims apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { POOL_SORT_WGSL } from './sortWgsl.ts'
import { POOL_SORT_WORDS, poolScratchWords } from './sortWords.ts'
import { POOL_RANKS } from './rank.ts'
import { sortPool } from './sort.fixture.ts'
import { runPoolSort } from './sortRun.fixture.ts'
import { mulberry32 } from '../../../../math/src/sequence/random.ts'

/** One sort of the slots of `ranks` with a burst of `burst`, its threads in `seed`'s order: the
 *  queue, and the total handed to the host. */
function queueOf(ranks: readonly number[], burst: number, seed: number) {
  const words = new Array<number>(POOL_SORT_WORDS).fill(0),
    scratch = new Array<number>(poolScratchWords(ranks.length, burst)).fill(0)
  const queue: number[] = []
  let placed = -1
  runPoolSort(
    POOL_SORT_WGSL,
    [],
    {
      poolSlotRank: (j: number) => (j < ranks.length ? ranks[j] : POOL_RANKS),
      poolSlotCount: () => ranks.length,
      poolBurst: () => burst,
      poolCountAdd: (i: number, v: number) => ((words[i] += v), words[i] - v),
      poolCountLoad: (i: number) => words[i],
      poolCountStore: (i: number, v: number) => void (words[i] = v),
      poolScratchLoad: (i: number) => scratch[i],
      poolScratchStore: (i: number, v: number) => void (scratch[i] = v),
      poolPlaced: (total: number) => void (placed = total),
      poolEmit: (at: number, j: number) => {
        assert.equal(queue[at], undefined, `place ${at} listed twice`)
        queue[at] = j
      },
    },
    ranks.length,
    mulberry32(seed),
  )
  assert.ok(
    words.slice(0, POOL_RANKS).every((c) => c === 0),
    'the counts zeroed for the next sort',
  )
  return { queue, placed }
}

for (const [label, slots, burst] of [
  ['under the burst', 700, 1024],
  ['past the burst, its boundary rank cut', 1500, 300],
] as const)
  test(`two runs, their threads shuffled apart, list the same queue ${label}`, () => {
    const random = mulberry32(slots)
    // Few ranks, many slots of each: the order within a rank is what timing would move.
    const ranks = Array.from({ length: slots }, () =>
      random() < 0.15 ? POOL_RANKS : 600 + Math.floor(random() * 6),
    )
    const first = queueOf(ranks, burst, 1),
      second = queueOf(ranks, burst, 2)
    assert.deepEqual(second.queue, first.queue)
    const mirror = sortPool(slots, (j) => ranks[j], burst)
    assert.deepEqual(first.queue, mirror.queue, 'the mirror: by rank, then slot')
    assert.equal(first.placed, mirror.total)
  })

test('a burst cut to the slots lists the same queue as a wider one', () => {
  // A host whose burst is no more than its slots (`evictWgsl.ts`, `poolBurst`) sizes the scratch
  // for those slots alone: every slot ranked, the boundary falls on the last rank; one in seven not
  // ranked, every one ranked is staged. Either way the queue and the total are the wide burst's.
  for (const skip of [0, 7]) {
    const random = mulberry32(31 + skip)
    const ranks = Array.from({ length: 700 }, (_, j) =>
      skip && j % skip === 0 ? POOL_RANKS : 600 + Math.floor(random() * 6),
    )
    const cut = queueOf(ranks, ranks.length, 3),
      wide = queueOf(ranks, 1024, 3)
    assert.deepEqual(cut, wide, skip ? 'some slots not ranked' : 'every slot ranked')
  }
})
