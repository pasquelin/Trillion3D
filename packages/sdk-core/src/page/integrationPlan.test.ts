import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  SLICE_OFFSET_WORDS,
  SLICE_PAGE_INDEX,
  SLICE_WORDS,
  SPEC_PAGE_INDEX,
  SPEC_STREAM_OFFSET,
  SPEC_TRIANGLES,
} from './integrationContracts.ts'
import { createPageIntegrationPlan, planPageIntegration, sortPages } from './integrationPlan.ts'
import type { PageIntegrationPlan } from './integrationPlan.ts'

/** A request sheet: per record, its byte offset in the pack (`-1`: a standalone page), its
 *  triangles and its page rank (`-1`: out of the table). */
function sheet(records: readonly (readonly [offset: number, triangles: number, page: number])[]) {
  const specs = new Int32Array(records.length * PAGE_SPEC_STRIDE)
  records.forEach(([offset, triangles, page], i) => {
    const at = i * PAGE_SPEC_STRIDE
    specs[at + SPEC_STREAM_OFFSET] = offset
    specs[at + SPEC_TRIANGLES] = triangles
    specs[at + SPEC_PAGE_INDEX] = page
  })
  return specs
}

/** The plan's records: first word in the pack, words, page rank. */
const slicesOf = (plan: PageIntegrationPlan) =>
  Array.from({ length: plan.count }, (_, i) => {
    const at = i * PAGE_SLICE_STRIDE
    return [
      plan.slices[at + SLICE_OFFSET_WORDS],
      plan.slices[at + SLICE_WORDS],
      plan.slices[at + SLICE_PAGE_INDEX],
    ]
  })

/** The plan's page ranks. */
const pagesOf = (plan: PageIntegrationPlan) => [...plan.pages.subarray(0, plan.pageCount)]

/** The ranks `0 .. count - 1`, in order. */
const ascending = (count: number) => Array.from({ length: count }, (_, i) => i)

/** Lengths well inside an insertion sort, and well past it. */
const SHORT = [2, 8],
  LONG = [256, 1024]

test('a packed arrival preserves its record order and reports sorted catalogue pages', () => {
  const plan = createPageIntegrationPlan(4)
  const answer = planPageIntegration(
    sheet([
      [24, 2, 7],
      [0, 3, 0],
      [60, 1, -1],
      [36, 2, 3],
    ]),
    18,
    plan,
  )
  assert.equal(answer, plan)
  assert.deepEqual(slicesOf(plan), [
    [6, 6, 7],
    [0, 9, 0],
    [15, 3, -1],
    [9, 6, 3],
  ])
  assert.deepEqual(pagesOf(plan), [0, 3, 7])
})

test('a standalone page takes its entire pack, including page zero', () => {
  const plan = planPageIntegration(sheet([[-1, 2, 0]]), 27, createPageIntegrationPlan(1))
  assert.deepEqual(slicesOf(plan), [[0, 27, 0]])
  assert.deepEqual(pagesOf(plan), [0])
})

test('a plan reused for a shorter arrival keeps its buffers and counts the new records', () => {
  const plan = createPageIntegrationPlan(3)
  planPageIntegration(
    sheet([
      [0, 1, 2],
      [12, 2, 4],
      [36, 3, 6],
    ]),
    18,
    plan,
  )
  const { slices, pages } = plan
  planPageIntegration(sheet([[8, 4, -1]]), 14, plan)
  assert.equal(plan.slices, slices)
  assert.equal(plan.pages, pages)
  assert.deepEqual(slicesOf(plan), [[2, 12, -1]])
  assert.deepEqual(pagesOf(plan), [])
  planPageIntegration(sheet([]), 0, plan)
  assert.deepEqual(slicesOf(plan), [])
  assert.deepEqual(pagesOf(plan), [])
})

test('an initially empty plan still has room for a later standalone arrival', () => {
  const plan = createPageIntegrationPlan(0)
  assert.deepEqual(slicesOf(plan), [])
  assert.deepEqual(pagesOf(plan), [])
  planPageIntegration(sheet([[-1, 1, 5]]), 12, plan)
  assert.deepEqual(slicesOf(plan), [[0, 12, 5]])
  assert.deepEqual(pagesOf(plan), [5])
})

test('a long arrival whose ranks already come in order, from page zero, is not sorted again', (t) => {
  for (const records of LONG) {
    const plan = createPageIntegrationPlan(records),
      view = t.mock.method(plan.pages, 'subarray')
    planPageIntegration(sheet(ascending(records).map((page) => [-1, 1, page])), 3, plan)
    assert.equal(view.mock.callCount(), 0, `${records} records`)
    assert.deepEqual([...plan.pages], ascending(records))
  }
})

test('a short list is sorted in place without a view, a long one through one view', (t) => {
  for (const [lengths, views] of [
    [SHORT, 0],
    [LONG, 1],
  ] as const) {
    for (const count of lengths) {
      const pages = new Int32Array(ascending(count).reverse()),
        view = t.mock.method(pages, 'subarray')
      sortPages(pages, count)
      assert.equal(view.mock.callCount(), views, `${count} ranks`)
      assert.deepEqual([...pages], ascending(count))
    }
  }
})

test('sorting orders only the requested prefix, repeated ranks kept', () => {
  const lists = [
    ...[0, 1, ...SHORT, ...LONG].map((count) =>
      Array.from({ length: count }, (_, i) => ((i * 37) % 131) - 60),
    ),
    [5, 3, 5, 0, 3],
    [-2, -1, 0, 1],
    [8, 7, 6, 5],
  ]
  for (const input of lists) {
    const pages = new Int32Array([...input, -999, 777])
    sortPages(pages, input.length)
    assert.deepEqual([...pages], [...input.sort((a, b) => a - b), -999, 777])
  }
})
