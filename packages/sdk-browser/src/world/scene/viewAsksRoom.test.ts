// A page read, then evicted before a frame took it, is read again only once the cache has room: a
// frame with no eviction. While the cache evicts at every frame, asking it again reads nothing —
// a cache with no room would take it in and throw it out, frame after frame, for nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts'
import { createViewAsks } from './viewAsks.ts'

test('a page evicted before it was taken is read again only after a frame with no eviction', async () => {
  const reads: string[] = []
  let evictions = 0
  const queue = {
    readBytes: async (url: string) => (reads.push(url), new Uint8Array(4)),
    stats: () => ({ evictions }),
  }
  const asks = createViewAsks(queue)
  asks.ask(['cell.json'], PRIORITY_PREFETCH)
  asks.end()
  await new Promise(setImmediate)
  // Landed, then evicted before any frame took it: every frame evicts while the cache is full.
  for (let frame = 0; frame < 5; frame++) {
    evictions += 3
    asks.ask(['cell.json'], PRIORITY_PREFETCH)
    asks.end()
    await new Promise(setImmediate)
  }
  assert.deepEqual(reads, ['cell.json'], 'read once while the cache has no room')
  // A frame went by with no eviction: room again, the page is read once more.
  asks.ask(['cell.json'], PRIORITY_PREFETCH)
  asks.end()
  asks.ask(['cell.json'], PRIORITY_PREFETCH)
  assert.deepEqual(reads, ['cell.json', 'cell.json'])
})
