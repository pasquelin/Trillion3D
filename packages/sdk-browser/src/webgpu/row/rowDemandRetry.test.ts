// The row demand asks again, at each readback, for every page the requests still close over that
// holds no row: a page missed once is never left wanted in no list, a row a rebuild drops is asked
// for again, the list keeps the GPU's order, and the host budget counts every table it keeps.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIRROR,
  closeAlone,
  closePairs,
  packedOf,
  rowCache,
  rowIdleSpan,
} from './rowCache.fixture.ts'
import { createRowDemand, type InstanceClosure } from './rowDemand.ts'
import { createRowUse } from './rowUse.ts'

test('a page that left the requests and came back after the serve passed it takes its row', () => {
  const cache = rowCache(4, 2)
  cache.land([0, 1])
  cache.frame()
  cache.land([3])
  cache.frame()
  // Page 2 is asked without its bytes, page 3 behind it finds every row in use: the serve passes
  // 2 and stops at 3.
  cache.readback([0, 1], [2, 3])
  cache.frame()
  // 2 leaves the requests and comes back, then lands while every row is still in use.
  cache.readback([0, 1], [3])
  cache.frame()
  cache.readback([0, 1], [2, 3])
  cache.frame()
  cache.land([2])
  cache.frame()
  // The drawn rows go unused: both requests take one back, 2 as 3 does.
  for (let k = 0, span = rowIdleSpan(); k <= span; k++) cache.readback([], [2, 3])
  cache.frame()
  cache.frame()
  assert.deepEqual(cache.held(), [2, 3])
})

test('a request resident when asked, its row dropped by a rebuild, is asked for again', () => {
  const cache = rowCache(3, 2),
    { rows } = cache
  cache.land([2])
  cache.frame()
  // Page 2 holds its row when the cut asks for it; 0 then takes the other row.
  cache.readback([2], [2])
  cache.frame()
  cache.land([0, 1])
  cache.frame()
  assert.deepEqual(cache.held(), [0, 2])
  // A new table: the rebuild places the resident pages in catalogue order, 2 left out.
  rows.rowsRevision++
  MIRROR.dirty = true
  cache.frame()
  MIRROR.dirty = true
  cache.frame()
  assert.ok(rows.rowOfPage[2] >= 0, 'the request takes a row back')
  assert.equal(rows.residentFlags[2], 1)
})

test('the demand is served in the GPU’s order: a nearer new request before an older one', () => {
  const table = {
    rowOfPage: new Int32Array(4).fill(-1),
    residentFlags: new Uint32Array(4),
  }
  const demand = createRowDemand(table, createRowUse(1), () => true, packedOf(4), closeAlone)
  const tried: number[] = []
  const refuse = (page: number) => (tried.push(page), false)
  demand.follow({ pageIds: [1] })
  demand.serve(() => true, refuse)
  // The table at its cap: 1 refused. The next readback ranks 2 before 1.
  demand.follow({ pageIds: [2, 1] })
  tried.length = 0
  demand.serve(() => true, refuse)
  assert.deepEqual(tried, [2])
  // Ahead requests follow the camera's, in their own order.
  demand.follow({ pageIds: [2, 1], aheadPageIds: [3, 0] })
  tried.length = 0
  demand.serve(
    () => true,
    (page) => (tried.push(page), true),
  )
  assert.deepEqual(tried, [2, 1, 3, 0])
})

test('the demand’s bytes count its closures and every list it keeps', () => {
  const closure = (): InstanceClosure => {
    const alone = closeAlone()
    return Object.assign(alone, { hostBytes: 5000 })
  }
  const table = { rowOfPage: new Int32Array(2).fill(-1), residentFlags: new Uint32Array(2) }
  const demand = createRowDemand(table, createRowUse(1), () => true, packedOf(2), closure)
  assert.ok(demand.bytes >= 10000, `${demand.bytes} bytes: the two closures counted`)
  // The three lists' differences count as theirs do: a longer readback, more bytes.
  const before = demand.bytes
  demand.follow({ pageIds: [0, 1] })
  assert.ok(demand.bytes >= before)
})

test('a group-mate a request closed over is served right behind that request, in its rank', () => {
  const table = { rowOfPage: new Int32Array(20).fill(-1), residentFlags: new Uint32Array(20) }
  const demand = createRowDemand(table, createRowUse(1), () => true, packedOf(20), closePairs)
  // The table at its cap refuses 3; the next readback ranks 1 before it.
  demand.follow({ pageIds: [3] })
  demand.serve(
    () => true,
    () => false,
  )
  demand.follow({ pageIds: [1, 3] })
  const served: number[] = []
  demand.serve(
    () => true,
    (page) => (served.push(page), true),
  )
  assert.deepEqual(served, [1, 11, 3, 13])
})
