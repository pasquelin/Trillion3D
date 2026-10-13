// The host reads the GPU cut's eviction queue page by page: it never walks the catalogue. Each
// order carries the arrivals its cut was made before, and closes while its selection's cut is held.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec } from '../../page/selection/selection.ts'
import type { GpuCut, GpuSelection } from '../../gpu/core/selection.ts'
import { createEvictionFeed } from './evictionFeed.ts'
import type { EvictionOrder } from '../../gpu/page/eviction.ts'

/** A feed over `pages`, its cache's arrivals set by the test, and each order it handed. */
function feedOver(pages: readonly PageRec[]) {
  const orders: (EvictionOrder | undefined)[] = []
  const cache = {
    arrivals: 0,
    refused: false,
    evictInOrder: (order?: EvictionOrder) => orders.push(order),
    takeRefused() {
      const refused = cache.refused
      cache.refused = false
      return refused
    },
  }
  return { cache, orders, feed: createEvictionFeed(pages, () => cache) }
}

const cutAt = (frame: number, ids: number[], old = 0) =>
  ({ uniforms: { frame }, result: { evictPageIds: ids, evictOld: old } }) as unknown as GpuCut

test('the queue reaches the cache as addresses, reading only the listed records', () => {
  const catalogue = Array.from({ length: 10_000 }, (_, id) => ({ url: `p${id}` }) as PageRec)
  let reads = 0
  const pages = new Proxy(catalogue, { get: (target, key) => (reads++, target[key as never]) })
  const { orders, feed } = feedOver(pages)
  let cut: GpuCut | null = null
  const selection = { peek: () => cut, cutHeld: false } as unknown as GpuSelection
  feed(selection, 4)
  cut = cutAt(4, [7, 3, 9000])
  feed(selection, 6)
  feed(selection, 7)
  const handed = orders.filter(Boolean)
  assert.equal(handed.length, 1, 'once per readback')
  assert.equal(reads, 0, 'nothing resolved before a victim is taken')
  assert.deepEqual([handed[0]!.count, handed[0]!.keyAt(1), reads], [3, 'p3', 1])
  cut = null // A residency change voided the cut: the order holds until the next readback.
  feed(selection, 8)
  assert.equal(orders.filter(Boolean).length, 1, 'a voided cut keeps the order')
})

test('an order names the arrivals of the frame its cut ran in, and its old head', () => {
  const pages = Array.from({ length: 8 }, (_, id) => ({ url: `p${id}` }) as PageRec)
  const { cache, orders, feed } = feedOver(pages)
  let cut: GpuCut | null = null
  const selection = { peek: () => cut, cutHeld: false } as unknown as GpuSelection
  cache.arrivals = 10
  feed(selection, 20)
  cache.arrivals = 14
  feed(selection, 21)
  cut = cutAt(20, [1, 2, 3], 2)
  cache.arrivals = 17
  feed(selection, 22)
  const order = orders.at(-1)!
  assert.deepEqual([order.arrivals, order.old, order.count], [10, 2, 3])
})

test('the order closes while the cut the frames draw is held, and opens again after', () => {
  const pages = Array.from({ length: 8 }, (_, id) => ({ url: `p${id}` }) as PageRec)
  const { orders, feed } = feedOver(pages)
  const state = { cut: cutAt(3, [1]) as GpuCut | null, held: false }
  const selection = {
    peek: () => state.cut,
    get cutHeld() {
      return state.held
    },
  } as unknown as GpuSelection
  feed(selection, 3)
  feed(selection, 4)
  const order = orders.at(-1)!
  assert.ok(order.open())
  state.held = true
  assert.ok(!order.open(), 'held: no page leaves')
  state.held = false
  assert.ok(order.open())
  // Another selection: its predecessor's order names its pages no more.
  const next = { peek: () => null, cutHeld: false } as unknown as GpuSelection
  feed(next, 5)
  assert.equal(orders.at(-1), undefined)
})

test('a refused load asks the GPU a new order, once the one in hand is old enough to move', () => {
  const pages = Array.from({ length: 8 }, (_, id) => ({ url: `p${id}` }) as PageRec)
  const { cache, feed } = feedOver(pages)
  let asked = 0
  const state = { cut: null as GpuCut | null }
  const selection = {
    peek: () => state.cut,
    cutHeld: false,
    askEvictions: () => void asked++,
  } as unknown as GpuSelection
  // No order yet: a refusal asks at once.
  cache.refused = true
  feed(selection, 10)
  assert.equal(asked, 1)
  state.cut = cutAt(10, [])
  feed(selection, 11)
  // The order in hand, cut at 10, is spent: a refusal at 11 waits, at 12 it asks again.
  cache.refused = true
  feed(selection, 11)
  assert.equal(asked, 1, 'too young: the ages have not moved')
  cache.refused = true
  feed(selection, 12)
  assert.equal(asked, 2)
  feed(selection, 13)
  assert.equal(asked, 2, 'no refusal, no question')
})
