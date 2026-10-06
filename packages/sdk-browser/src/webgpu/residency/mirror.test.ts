// #836, audit of #888: a pooled key is noted to the GPU pool list (`../pages/services.ts`,
// `notePool`) at its arrival, for every placement, whether a row was written or not: the mirror
// reads the cache and the static catalogue only, so no key holds its slot outside the queue.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuResidencyMirror } from './mirror.ts'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'

test('a key the pool takes is noted for each placement at its arrival, before any row', () => {
  const noted: number[][] = []
  const arrivals: [string, number][] = [
    ['k', 16],
    ['k', -1],
  ]
  let resident = 0
  const cache = {
    drainResidencyChanges(keys: string[], slots: number[]) {
      const [key, words] = arrivals.shift()!
      keys.push(key)
      slots.push(words)
      resident = words >= 0 ? 1 : 0
    },
    stats: () => ({ residentPages: resident }),
  }
  const mirror = createWebgpuResidencyMirror({
    table: {
      // Key `k` at packed ranks 0 and 2: two placements of one primitive page.
      instances: {
        each(key: string, visit: (packed: number) => void) {
          if (key === 'k') [0, 2].forEach((packed) => visit(packed))
          return key === 'k'
        },
        first: (key: string) => (key === 'k' ? 0 : undefined),
      },
      residentOffsetWords: new Int32Array(3).fill(-1),
    },
    tracking: createWebgpuPageTracking([]),
    engineDiagnostic: () => {},
    getCache: () => cache as never,
    getFrame: () => 0,
    onOffsetChange: (page, words) => noted.push([page, words]),
  })
  mirror.sync()
  mirror.sync()
  assert.deepEqual(
    noted,
    [
      [0, 16],
      [2, 16],
      [0, -1],
      [2, -1],
    ],
    'arrival, then departure',
  )
})
