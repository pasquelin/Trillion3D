// A cut's flags start each section within one binding's worth of the device, as they grow: a reach
// past it is grown into, never refused up front; queue 0 keeps a root slot a placement. The flags
// are one record table (`cutTables.ts`): its sections are the kernel's, word for word.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dagFlagShape,
  evictScratchWords,
  flagSectionStart,
  grownFlagShape,
} from './flagSections.ts'
import { QUEUE_DROPPED } from './shader/viewsWgsl.ts'
import { LEVEL_QUEUES } from './shader/levelWgsl.ts'

const packed = { queueEntries: 1811, worldCount: 600, pageCount: 1800, candCount: 1800 }

test('a device that binds less than the reach starts each section within one binding', () => {
  const limits = { maxStorageBufferBindingSize: 12800 }
  // One binding's 3200 words: a queue's even count of them, a list's live entries three each.
  const shape = dagFlagShape(packed, limits)
  assert.deepEqual(shape, { queueWords: 3200, candCap: 1066 })
  // Growth stops at the same bound: one rule for the start and the growth.
  const bounds = { entryCount: 1811, pageCount: 1800 }
  assert.equal(grownFlagShape(limits, bounds, shape, QUEUE_DROPPED), undefined)
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

test('a device holding the reach keeps it, and queue 0 never drops a placement’s root slot', () => {
  assert.deepEqual(dagFlagShape(packed, { maxStorageBufferBindingSize: 1 << 27 }), {
    queueWords: 3622,
    candCap: 1800,
  })
  // A binding narrower than the roots: the queue keeps them, in its record table.
  const narrow = dagFlagShape(packed, { maxStorageBufferBindingSize: 2048 })
  assert.equal(narrow.queueWords, 1200)
})

test("the eviction sort's scratch follows the cut's pages, never the global cap", () => {
  // Two words a staged key under the burst the pool's list can take, two a group of 256 keys
  // (`poolScratchWords`, one group at least): no page, 2 * 1; three pages, 2 * 3 + 2 * 1; 1,800
  // pages, 2 * 1024 + 2 * 8; the cap's
  // 262,144 and past it, 2 * 1024 + 2 * 1024. The sort that sized it for the cap whatever the
  // scene took 4,096 words for three pages.
  assert.deepEqual([0, 3, 1800, 262144, 1 << 20].map(evictScratchWords), [2, 8, 2064, 4096, 4096])
})
