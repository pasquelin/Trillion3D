// A readback past the device's list is adopted by its head, nothing exiting on it
// (`../cut/adoption.ts`): the host's lists still name a page the cut left. The rows in use are the
// GPU's to say, from the cut's whole lists: under a full table, a request takes the row of the page
// the cut left, where a host closure of the adopted lists held it and grew the table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { range, rowCache } from './rowCache.fixture.ts'
import { ROW_IN_USE } from './rowEvictSortWgsl.ts'

test('the row of a page the cut left serves a request while the readbacks are truncated', () => {
  const cache = rowCache(4, 3),
    { rows } = cache
  cache.land(range(4))
  cache.frame()
  assert.deepEqual(cache.held(), [0, 1, 2])
  cache.readback([0, 1, 2], [])
  cache.frame()
  // The view moves: the cut draws 0 and 1 alone; the host adopts the head of a truncated readback
  // and the drawn page it held, 2, never exits.
  let denied = 0
  for (let k = 0; k <= ROW_IN_USE; k++) {
    cache.readback([0, 1, 2], [0, 1], { drawn: [0, 1], asked: [0, 1] })
    cache.frame()
    denied += rows.rowsDenied
  }
  // Then it asks for 3.
  cache.readback([0, 1, 2], [0, 1, 3], { drawn: [0, 1], asked: [0, 1, 3] })
  cache.frame()
  denied += rows.rowsDenied
  assert.deepEqual(cache.held(), [0, 1, 3], 'the row of 2, which no cut used, serves 3')
  assert.equal(denied, 0, 'the table never grows for it')
})
