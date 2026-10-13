// A pooled key is noted to the GPU pool list (`../pages/services.ts`, `notePool`) at its arrival,
// for every placement, whether a row was written or not; and a page's slot is read on the cache,
// never mirrored (`../row/pageState.ts`): a slot the cache moved is the one every reader sees, before
// any sync, and nothing is ever rebuilt from the catalogue.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuResidencyMirror } from './mirror.ts'
import { createGpuPageCache } from '../../gpu/page/pages.ts'
import { createWebgpuRowState } from '../row/state.ts'
import { pageAddress } from '../row/pageSlots.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import type { PageRec } from '../../page/selection/selection.ts'

const LIMITS = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 }

test('a key the pool takes is noted for each placement at its arrival, before any row', () => {
  const noted: number[][] = []
  const arrivals: [string, number][] = [
    ['k', 16],
    ['k', -1],
  ]
  const cache = {
    drainResidencyChanges(keys: string[], slots: number[]) {
      const [key, words] = arrivals.shift()!
      keys.push(key)
      slots.push(words)
    },
  }
  const mirror = createWebgpuResidencyMirror({
    table: {
      // Key `k` at packed ranks 0 and 2: two placements of one primitive page.
      instances: {
        each(key: string, visit: (packed: number) => void) {
          if (key === 'k') [0, 2].forEach((packed) => visit(packed))
          return key === 'k'
        },
      },
    },
    getCache: () => cache,
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

/** Eight pages of one placement over a real page cache of `slots` slots, the row state reading its
 *  slots on it. */
function pooled(slots: number) {
  const { device } = fakeDevice({ limits: LIMITS })
  const cache = createGpuPageCache(
    device,
    { read: async () => new Uint8Array(8) },
    { pageBytes: 8, slots },
  )
  const pages = Array.from({ length: 8 }, (_, i) => ({ url: `p${i}` }) as PageRec)
  const rows = createWebgpuRowState(pages, 4, 0, undefined, (address) => {
    const page = cache.get(address)
    return page ? page.offset / 4 : -1
  })
  return { cache, pages, rows }
}

test('a slot the cache moves is the one every instance reads, before any sync', async () => {
  const { cache, pages, rows } = pooled(4)
  await cache.load(pageAddress(pages[0]))
  const before = rows.offsetOf(0)
  // The pool shrinks: the page moves to the lowest free slot, and no journal was drained.
  await cache.resize(2)
  const moved = cache.get(pageAddress(pages[0]))!
  assert.notEqual(moved.offset / 4, before, 'the page moved')
  assert.equal(rows.offsetOf(0), moved.offset / 4)
})

test('loads, evictions and resizes: every instance reads the cache, never a stale slot', async () => {
  const { cache, pages, rows } = pooled(6)
  const next = lcgRandom(0x1527)
  for (let step = 0; step < 200; step++) {
    const pick = Math.floor(next() * pages.length),
      key = pageAddress(pages[pick]),
      roll = next()
    if (roll < 0.6) await cache.load(key).catch(() => {})
    else if (roll < 0.85) cache.unload(key)
    else await cache.resize(3 + Math.floor(next() * 4))
    for (let page = 0; page < pages.length; page++) {
      const held = cache.get(pageAddress(pages[page]))
      assert.equal(rows.offsetOf(page), held ? held.offset / 4 : -1, `page ${page} at ${step}`)
    }
  }
})
