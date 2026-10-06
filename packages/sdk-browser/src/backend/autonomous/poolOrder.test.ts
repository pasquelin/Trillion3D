import test from 'node:test'
import assert from 'node:assert/strict'
import { createResidentOrder } from './poolOrder.ts'
import type { PageRec } from '../../page/selection/selection.ts'

// #839: a coarser page the image let go of is held over one `keep`, never for as long as a finer
// page leaves each image — a moving view would otherwise hold every coarse page it passed.
test('a view that lets go of a finer page every image still releases the coarse ones it passed', () => {
  const recs = new Map<string, PageRec>()
  const rec = (url: string, level: number) => {
    if (!recs.has(url)) recs.set(url, { url, level } as PageRec)
    return recs.get(url)!
  }
  const order = createResidentOrder({
    state: { allocationBytes: 0 },
    drop: () => {},
    limit: () => Infinity,
    floorBytes: () => 0,
    pageBytes: () => 1,
    parentsOf: () => [],
  })
  let most = 0
  for (let t = 0; t < 200; t++) {
    const view = [0, 1, 2, 3, 4].map((i) => rec(`f${t + i}`, 0))
    view.push(rec(`c${Math.floor(t / 5)}`, 2))
    // A finer fallback drawn but not asked for: it leaves at every trim.
    order.follow(view, [...view, rec(`g${t}`, 1)])
    order.trim()
    most = Math.max(most, order.keyCount)
  }
  assert.ok(most <= 10, `${most} keys for a view of 7 pages`)
})

// #839: a released parent a newly kept child holds again leaves the order, so it never goes first.
test('a parent held again through a kept child is not evicted under it', () => {
  const parent = { url: 'p', level: 1 } as PageRec,
    child = { url: 'c', level: 0 } as PageRec
  const state = { allocationBytes: 0 },
    dropped: string[] = []
  const order = createResidentOrder({
    ...{ state, limit: () => 10, floorBytes: () => 0, pageBytes: () => 1 },
    drop: (url) => dropped.push(url),
    parentsOf: (rec) => (rec === child ? [parent] : []),
  })
  const image = (view: PageRec[], times = 1) => {
    for (let i = 0; i < times; i++) {
      order.follow(view, view)
      order.trim()
    }
  }
  order.follow([parent, child], [child])
  ;['p', 'c'].forEach(order.arrived)
  image([], 4) // the view leaves: both are released into the order
  image([child]) // it comes back to the child alone, then the pool runs over
  state.allocationBytes = 20
  image([child])
  assert.deepEqual(dropped, [])
})
