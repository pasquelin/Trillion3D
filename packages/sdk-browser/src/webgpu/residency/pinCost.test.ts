// The pins follow what arrives, never what waits: a pool its pins fill can keep the image waiting
// on a hundred thousand pages, and the pin step of each image asks the cache of none of them —
// each arrival is read once, and the page it brings is pinned then.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuPinUpdater } from './pinUpdater.ts'
import { lruCache, pageOf } from './residentEnsurer.fixture.ts'
import { setsOver } from './sets.fixture.ts'

for (const count of [1e3, 1e5])
  test(`${count} kept pages waiting: the pin step asks the cache of none, and pins one on arrival`, async () => {
    const pages = Array.from({ length: count }, (_, k) => pageOf(`p${k}`))
    const tracking = createWebgpuPageTracking(pages)
    const sets = setsOver(tracking, new Uint8Array(tracking.keyCount), pages)
    const keys = Int32Array.from(pages, (page) => tracking.keyOf(page))
    sets.admit(keys, pages, count)
    const cache = lruCache(count),
      gets = { count: 0 }
    const get = cache.get
    cache.get = (url: string) => (gets.count++, get(url))
    const pins = createWebgpuPinUpdater({
      tracking,
      sets,
      bootstrapKey: new Uint8Array(tracking.keyCount),
      deferredDrops: new Set(),
      byUrl: new Map(),
      parentsOf: () => [],
      traceEnabled: false,
      traceDiagnostic: () => {},
    })
    pins(cache as never, [], 1, () => {})
    for (let frame = 2; frame < 6; frame++) {
      gets.count = 0
      pins(cache as never, [], frame, () => {})
      assert.ok(gets.count <= 1, `frame ${frame}: ${gets.count} cache reads`)
    }
    await cache.load('p7')
    pins(cache as never, [], 6, () => {})
    assert.ok(cache.pins.has('p7'), 'the page that arrived is pinned')
    assert.equal(cache.pins.size, 1)
  })
