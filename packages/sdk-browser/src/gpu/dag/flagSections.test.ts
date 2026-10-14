// A cut's flags start each section at a view's reach and grow past it on demand, bound by the entries
// and pages alone, never by a storage binding: the flags are one record table (`cutTables.ts`),
// its sections the kernel's, word for word.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dagFlagShape,
  evictScratchWords,
  flagSectionStart,
  grownFlagShape,
} from './flagSections.ts'
import { LIST_DROPPED, QUEUE_DROPPED } from './shader/viewsWgsl.ts'
import { LEVEL_QUEUES } from './shader/levelWgsl.ts'

const packed = { queueEntries: 1811, pageCount: 1800, candCount: 1800 }

test('the sections start at the reach: two words a queue entry, an entry a page', () => {
  assert.deepEqual(dagFlagShape(packed), { queueWords: 3622, candCap: 1800 })
})

test('a section grows past one storage binding: the entries and pages alone bound it', () => {
  // 2²⁶ words a queue and 2²⁵ live entries, three words each: past the 128 MiB binding a guaranteed
  // device holds, which once capped every section, the record table holds them.
  const shape = { queueWords: 1 << 25, candCap: 1 << 24 },
    both = QUEUE_DROPPED | LIST_DROPPED
  assert.deepEqual(grownFlagShape({ entryCount: 1 << 26, pageCount: 1 << 26 }, shape, both), {
    queueWords: 1 << 26,
    candCap: 1 << 25,
  })
  // Every entry and every page held already: nothing grows, the view coarsens.
  const bounds = { entryCount: 1 << 24, pageCount: 1 << 24 }
  assert.equal(grownFlagShape(bounds, shape, both), undefined)
})

test("the sections are the kernel's: queue 0, the lists and logs, the queues", () => {
  // Queue 0, the four lists, then the other queues.
  const shape = { queueWords: 14, candCap: 100 },
    last = 4 + LEVEL_QUEUES - 1
  assert.equal(flagSectionStart(1, shape), 14, 'the candidates, behind queue 0')
  assert.equal(flagSectionStart(2, shape), 14 + 2 * 100, 'the live list, behind them')
  assert.equal(flagSectionStart(3, shape), 14 + 5 * 100, 'the drawn log, behind it')
  assert.equal(flagSectionStart(4, shape), 14 + 6 * 100, 'the log being written, behind it')
  assert.equal(
    flagSectionStart(last, shape),
    14 * (LEVEL_QUEUES - 1) + 7 * 100,
    'the last queue, behind the lists and the queues before it',
  )
})

test("the eviction sort's scratch follows the cut's pages, never the global cap", () => {
  // Two words a staged key under the burst the pool's list can take, two a group of 256 keys
  // (`poolScratchWords`, one group at least): no page, 2 * 1; three pages, 2 * 3 + 2 * 1; 1,800
  // pages, 2 * 1024 + 2 * 8; the cap's
  // 262,144 and past it, 2 * 1024 + 2 * 1024. The sort that sized it for the cap whatever the
  // scene took 4,096 words for three pages.
  assert.deepEqual([0, 3, 1800, 262144, 1 << 20].map(evictScratchWords), [2, 8, 2064, 4096, 4096])
})
