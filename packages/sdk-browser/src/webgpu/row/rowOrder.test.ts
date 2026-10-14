// The rows' victim order: the GPU's queue taken by page wherever a move put its row, never a page
// that took its row after the queue's cut, and a request denied — the table growing — only when
// the GPU found nothing more to give or no queue came for a while; else it waits, and asks a cut.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRowOrder } from './rowOrder.ts'
import { createRowUseWords } from './rowWords.ts'
import { ROW_IN_USE } from './rowEvictSortWgsl.ts'

/** A table of rows whose pages the test sets, its words, and an order over them. */
function table() {
  const rowOf = new Map<number, number>(),
    words = createRowUseWords()
  words.fit(16)
  let asks = 0
  const order = createRowOrder(
    (page) => rowOf.get(page) ?? -1,
    words,
    () => void asks++,
  )
  const place = (row: number, page: number) => {
    rowOf.set(page, row)
    words.assign(row, page, 0)
  }
  return { rowOf, words, order, place, asks: () => asks }
}

test('a queued page is taken wherever its row moved; one placed after the cut never', () => {
  const t = table()
  t.place(0, 10)
  t.place(1, 11)
  t.order.noteFrame(5)
  // After frame 5's cut: page 12 takes row 2, page 10's row moves to rank 3.
  t.place(2, 12)
  t.words.moved(0, 3, 6)
  t.rowOf.set(10, 3)
  t.order.follow(Uint32Array.from([12, 10, 11]), 3, 5)
  assert.equal(t.order.victim(), 10, 'page 12 arrived after the cut: skipped')
  assert.equal(t.order.victim(), 11)
  assert.equal(t.order.victim(), undefined)
})

test('a queue of a frame the order never noted is not followed', () => {
  const t = table()
  t.place(0, 10)
  t.order.follow(Uint32Array.from([10]), 1, 9)
  assert.equal(t.order.victim(), undefined)
})

test('a request waits for the queue it asks a cut for, and is denied when none comes', () => {
  const t = table()
  t.place(0, 10)
  t.place(1, 11)
  assert.equal(t.order.denies(0), true, 'no queue ever came: nothing says a row may go')
  t.order.noteFrame(20)
  t.order.follow(Uint32Array.from([10]), 2, 20)
  assert.equal(t.order.victim(), 10)
  assert.equal(t.order.denies(21), false, 'one more ranked behind the burst: it asks and waits')
  assert.equal(t.asks(), 1)
  assert.equal(t.order.denies(22), false)
  assert.equal(t.asks(), 1, 'asked once until a queue comes')
  assert.equal(t.order.denies(22 + 2 * ROW_IN_USE), true, 'no cut ranked one since: denied')
  t.order.noteFrame(22)
  t.order.follow(Uint32Array.from([11]), 1, 22)
  assert.equal(t.order.victim(), 11)
  assert.equal(t.order.denies(23), true, 'every row the GPU ranked taken: nothing more to give')
})
