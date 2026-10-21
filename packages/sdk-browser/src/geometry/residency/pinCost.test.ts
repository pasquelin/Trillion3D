// The pins follow what arrives, never what waits: a root cover of a hundred thousand pages still
// on their way costs the pin step of each image no question to the cache — each arrival is read
// once, and the page it brings is pinned then.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../rows/page/pageTracking.ts'
import { createWebgpuPinUpdater } from './pinUpdater.ts'
import { rec, setsOver } from './sets.fixture.ts'

/** A pool that holds what it loads, hands the pin step what arrived since it last asked, and pins:
 *  what the pin step reads of the GPU page cache (`../pages/pool/pages.ts`). */
function arrivalPool() {
  const resident = new Set<string>(),
    pins = new Set<string>(),
    arrivals: string[] = []
  return {
    pins,
    get: (url: string) => resident.has(url) || undefined,
    load(url: string) {
      resident.add(url)
      arrivals.push(url)
    },
    takeArrivals(visit: (url: string) => void) {
      for (const url of arrivals) visit(url)
      arrivals.length = 0
    },
    takeUnpinned() {},
    pin: (url: string) => void pins.add(url),
    isPinned: (url: string) => pins.has(url),
    unpin: (url: string) => pins.delete(url),
    stats: () => ({ pinned: pins.size }),
  }
}

for (const count of [1e3, 1e5])
  test(`${count} covered pages waiting: the pin step asks the cache of each once, and pins one on arrival`, () => {
    const pages = Array.from({ length: count }, (_, k) => rec(`p${k}`, 0))
    const tracking = createWebgpuPageTracking(pages)
    const bootstrapKey = new Uint8Array(tracking.keyCount).fill(1)
    const sets = setsOver(tracking, bootstrapKey, pages)
    const cache = arrivalPool(),
      gets = { count: 0 }
    const get = cache.get
    cache.get = (url: string) => (gets.count++, get(url))
    const pins = createWebgpuPinUpdater({
      tracking,
      sets,
      bootstrapKey,
      deferredDrops: new Set(),
      traceEnabled: false,
      traceDiagnostic: () => {},
    })
    pins(cache as never, [], 1, () => {})
    assert.equal(gets.count, count, 'the cover at open, each key asked once')
    for (let frame = 2; frame < 6; frame++) {
      gets.count = 0
      pins(cache as never, [], frame, () => {})
      assert.equal(gets.count, 0, `frame ${frame}: ${gets.count} cache reads`)
    }
    cache.load('p7')
    pins(cache as never, [], 6, () => {})
    assert.ok(cache.pins.has('p7'), 'the page that arrived is pinned')
    assert.equal(cache.pins.size, 1)
  })
