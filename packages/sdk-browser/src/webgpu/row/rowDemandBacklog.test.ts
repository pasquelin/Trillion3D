// What the row demand leaves for the next serve stays its live requests alone: one entry per page,
// the passed and the let go dropped, a refusal counting only what asks without a row, the backlog
// ranked again behind every serve that did not drain it, a waiting group-mate kept behind its
// request, and no scratch made per readback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeAlone, closePairs } from './rowCache.fixture.ts'
import { createRowDemand, type InstanceClosure } from './rowDemand.ts'
import { createRowUse } from './rowUse.ts'
import { createFrameBudget } from '../../page/integration/frameBudget.ts'

/** A demand over `pages` instances none of which holds a row. */
function demandOf(pages: number, closure: () => InstanceClosure = closeAlone) {
  const table = { rowOfPage: new Int32Array(pages).fill(-1), residentFlags: new Uint32Array(pages) }
  return createRowDemand(table, createRowUse(1), () => true, pages, closure)
}

const always = () => true,
  never = () => false

test('requests that come and go behind a refused head leave no entry behind them', () => {
  const demand = demandOf(4)
  const round = (k: number) => {
    demand.follow({ pageIds: [1 + (k % 2)] })
    demand.serve(always, never)
  }
  for (let k = 0; k < 16; k++) round(k)
  const settled = demand.bytes
  for (let k = 16; k < 4096; k++) round(k)
  assert.equal(demand.bytes, settled, 'the list holds the live requests, not the readbacks')
  assert.equal(demand.waiting, 1)
})

test('a refusal counts the live requests without a row, not the entries let go', () => {
  const demand = demandOf(4)
  demand.follow({ pageIds: [1, 2, 3] })
  // 2 and 3 are let go before any serve.
  demand.follow({ pageIds: [1] })
  assert.equal(demand.serve(always, never), 1)
})

test('a table grown serves each live request once: no entry the serve passed comes back', () => {
  const demand = demandOf(4)
  demand.follow({ pageIds: [1, 2] })
  // 1 waits for its bytes and is passed; 2 finds the table at its cap.
  demand.serve((page) => page !== 1, never)
  // 1 lands, then the table grows.
  demand.touched([1], 1)
  demand.restart()
  assert.equal(demand.waiting, 2)
  const served: number[] = []
  demand.serve(always, (page) => (served.push(page), true))
  assert.deepEqual(served.sort(), [1, 2])
})

test('a nearer request is served before what the frame’s budget left of an older readback', () => {
  const demand = demandOf(4)
  demand.follow({ pageIds: [1, 2] })
  // The budget lets one row through: 2 is left for the next image.
  let now = 0
  const budget = createFrameBudget(1, () => now)
  budget.open()
  demand.serve(always, () => ((now += 5), true), budget)
  assert.equal(demand.waiting, 1)
  demand.follow({ pageIds: [3, 2] })
  const served: number[] = []
  demand.serve(always, (page) => (served.push(page), true))
  assert.deepEqual(served, [3, 2])
})

test('a group-mate that lands after the serve passed it is served right behind its request', () => {
  const demand = demandOf(20, closePairs)
  demand.follow({ pageIds: [3, 5] })
  // 3 takes its row, its mate 13 waits for its bytes, 5 finds the table at its cap.
  demand.serve(
    (page) => page !== 13,
    (page) => page === 3,
  )
  demand.touched([13], 1)
  demand.follow({ pageIds: [3, 5] })
  const served: number[] = []
  demand.serve(always, (page) => (served.push(page), true))
  assert.deepEqual(served, [13, 5, 15])
})

test('ranking a backlog again makes no array once its scratch fits', () => {
  const demand = demandOf(64)
  const asks = Array.from({ length: 32 }, (_, k) => k)
  const round = (k: number) => {
    demand.follow({ pageIds: k % 2 ? asks : [...asks].reverse() })
    demand.serve(always, never)
  }
  for (let k = 0; k < 4; k++) round(k)
  const Real = globalThis.Float64Array
  let made = 0
  globalThis.Float64Array = class extends Real {
    constructor(...args: unknown[]) {
      super(...(args as [number]))
      made++
    }
  } as typeof Float64Array
  try {
    for (let k = 4; k < 64; k++) round(k)
  } finally {
    globalThis.Float64Array = Real
  }
  assert.equal(made, 0)
})
