// The host reads the GPU cut's eviction queue page by page: it never walks the catalogue (#872).
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec } from '../../page/selection/selection.ts'
import type { GpuCut, GpuSelection } from '../../gpu/core/selection.ts'
import { createEvictionFeed } from './evictionFeed.ts'
import { type EvictionOrder } from '../../gpu/page/slotEvictionOrder.ts'

test('the queue reaches the cache as addresses, reading only the listed records', () => {
  const catalogue = Array.from({ length: 10_000 }, (_, id) => ({ url: `p${id}` }) as PageRec)
  let reads = 0
  const pages = new Proxy(catalogue, { get: (target, key) => (reads++, target[key as never]) })
  const orders: (EvictionOrder | undefined)[] = []
  const cache = { evictInOrder: (order?: EvictionOrder) => orders.push(order) }
  const feed = createEvictionFeed(pages, () => cache)
  let cut: GpuCut | null = { result: { evictPageIds: [7, 3, 9000] } } as GpuCut
  const selection = { peek: () => cut } as unknown as GpuSelection
  feed(selection)
  feed(selection)
  assert.equal(orders.length, 1, 'once per readback')
  assert.equal(reads, 0, 'nothing resolved before a victim is taken')
  assert.deepEqual([orders[0]!.count, orders[0]!.keyAt(1), reads], [3, 'p3', 1])
  cut = null // A residency change voided the cut: the order holds until the next readback.
  feed(selection)
  assert.equal(orders.length, 1, 'a voided cut keeps the order')
})
