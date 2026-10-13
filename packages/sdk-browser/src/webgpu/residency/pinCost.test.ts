// The pins follow what arrives, never what waits: a root cover of a hundred thousand pages still
// on their way costs the pin step of each image no question to the cache — each arrival is read
// once, and the page it brings is pinned then.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuPinUpdater } from './pinUpdater.ts'
import { orderedPool, pageOf } from './residentEnsurer.fixture.ts'
import { setsOver } from './sets.fixture.ts'

for (const count of [1e3, 1e5])
  test(`${count} covered pages waiting: the pin step asks the cache of each once, and pins one on arrival`, async () => {
    const pages = Array.from({ length: count }, (_, k) => pageOf(`p${k}`))
    const tracking = createWebgpuPageTracking(pages)
    const bootstrapKey = new Uint8Array(tracking.keyCount).fill(1)
    const sets = setsOver(tracking, bootstrapKey, pages)
    const cache = orderedPool(count),
      gets = { count: 0 },
      relisted: string[] = []
    const get = cache.get
    cache.get = (url: string) => (gets.count++, get(url))
    const pins = createWebgpuPinUpdater({
      tracking,
      sets,
      bootstrapKey,
      deferredDrops: new Set(),
      relist: (url) => relisted.push(url),
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
    await cache.load('p7')
    pins(cache as never, [], 6, () => {})
    assert.ok(cache.pins.has('p7'), 'the page that arrived is pinned')
    assert.equal(cache.pins.size, 1)
    assert.deepEqual(relisted, ['p7'], 'and out of the GPU pool list')
  })
