// The transfer queue is a binary heap on (priority, arrival): a job leaves, or is taken out
// wherever it stands, in O(log n). Oracles: the version that re-sorted the whole queue at every
// admission, and the one that found a cancelled job by a sweep, in
// `../../../../bench/oracles/browser/`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createJobHeap, takeAdmissible } from './queueOrder.ts'
import { referenceAdmission } from '../../../../bench/oracles/browser/arrival-admission.ts'
import { referenceRetireDeLaFile } from '../../../../bench/oracles/browser/streaming-lookups.ts'
import type { Job } from './types.ts'

const LIMIT = 6,
  BUDGET = 2 * 1024 * 1024

type Plain = { url: string; priority: number; order: number; consumers: number }
type Queued = Plain & { bytes: number; slot: number }

/** The engine's admission of `jobs`, as `createPump` runs it on the heap. */
function heapAdmission(jobs: readonly Plain[], bytesOf: (url: string) => number) {
  const heap = createJobHeap<Queued>()
  for (const job of jobs) heap.push({ ...job, bytes: bytesOf(job.url), slot: -1 })
  const admitted: string[] = []
  let active = 0,
    activeBytes = 0
  for (let job; active < LIMIT && (job = takeAdmissible(heap, active, activeBytes, BUDGET));) {
    if (job.consumers === 0) continue
    active++
    activeBytes += job.bytes
    admitted.push(job.url)
  }
  return admitted
}

/** Both admissions of `jobs`, the heap's and the oracle's. */
const both = (jobs: Plain[], bytesOf: (url: string) => number) => [
  heapAdmission(jobs, bytesOf),
  referenceAdmission(jobs.slice(), bytesOf),
]

const pages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ url: `p${i}`, priority: 0, order: i, consumers: 1 }))

test('an empty queue admits nothing, matching the reference', () => {
  assert.deepEqual(
    both([], () => 0),
    [[], []],
  )
})

test('priority then arrival order decides admission, identically to the reference', () => {
  const jobs = [
    { url: 'c', priority: 2, order: 2, consumers: 1 },
    { url: 'a', priority: 1, order: 0, consumers: 1 },
    { url: 'b', priority: 1, order: 1, consumers: 1 },
  ]
  assert.deepEqual(
    both(jobs, () => 1024),
    [
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ],
  )
})

test('a job with zero consumers is skipped by both sides without stopping admission', () => {
  const jobs = [
    { url: 'a', priority: 0, order: 0, consumers: 0 },
    { url: 'b', priority: 1, order: 1, consumers: 1 },
  ]
  assert.deepEqual(
    both(jobs, () => 1024),
    [['b'], ['b']],
  )
})

test('the first transfer always admits even alone over budget, then blocks everything behind it', () => {
  const [heap, reference] = both(pages(10), (url) => (url === 'p0' ? BUDGET * 4 : 1024))
  assert.deepEqual([heap, reference], [['p0'], ['p0']])
})

test('a job past the budget is passed over, the smaller ones behind it admitted, as the reference', () => {
  const [heap, reference] = both(pages(10), (url) => (url === 'p2' ? BUDGET : 1024))
  assert.deepEqual(heap, reference)
  assert.deepEqual(heap, ['p0', 'p1', 'p3', 'p4', 'p5', 'p6'])
})

test('same-size jobs within budget fill up to the active-transfer limit, identically to the reference', () => {
  const [heap, reference] = both(pages(10), () => 1024)
  assert.deepEqual([heap, heap.length], [reference, LIMIT])
})

/** A job of `url` at `priority`, arrived `order`-th, out of any queue. */
function job(url: string, order: number, priority = 0): Job {
  return {
    ...{ url, priority, order, bytes: 0, slot: -1, controller: new AbortController() },
    ...{ state: 'queued', consumers: new Set(), promise: new Promise(() => {}) },
    ...{ resolve: () => {}, reject: () => {} },
  }
}

/** Every job of `heap`, first to last, taken out. */
function drained(heap: ReturnType<typeof createJobHeap<Job>>) {
  const urls: string[] = []
  for (let first = heap.pop(); first; first = heap.pop()) urls.push(first.url)
  return urls
}

test('a cancelled job taken out where it stands leaves the queue an immediate remove leaves', () => {
  const old = ['a', 'b', 'c', 'd'].map((url, at) => job(url, at))
  const heap = createJobHeap<Job>()
  const queued = ['a', 'b', 'c', 'd'].map((url, at) => job(url, at))
  queued.forEach((each) => heap.push(each))
  for (const url of ['b', 'd']) {
    referenceRetireDeLaFile(
      old,
      old.find((each) => each.url === url)!,
    )
    heap.remove(queued.find((each) => each.url === url)!)
  }
  old.push(job('e', 4))
  heap.push(job('e', 4))
  assert.deepEqual(
    drained(heap),
    old.map((each) => each.url),
  )
  assert.deepEqual(
    old.map((each) => each.url),
    ['a', 'c', 'e'],
  )
})

test('a job out of the queue, or taken out twice, moves nothing', () => {
  const heap = createJobHeap<Job>()
  const [a, b] = [job('a', 0), job('b', 1)]
  heap.push(a)
  heap.push(b)
  assert.equal(heap.remove(job('x', 9)), false)
  assert.equal(heap.remove(a), true)
  assert.equal(heap.remove(a), false)
  assert.deepEqual(drained(heap), ['b'])
})

test('a job whose priority rose climbs before those it now precedes', () => {
  const heap = createJobHeap<Job>()
  const queued = Array.from({ length: 8 }, (_, i) => job(`p${i}`, i, 3))
  queued.forEach((each) => heap.push(each))
  queued[6].priority = 1
  heap.raise(queued[6])
  assert.deepEqual(drained(heap), ['p6', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p7'])
})

test('the first admissible job is found in the queue order without moving any job', () => {
  const heap = createJobHeap<Job>()
  const queued = Array.from({ length: 12 }, (_, i) => job(`p${i}`, i, (i * 5) % 3))
  queued.forEach((each) => (each.bytes = each.url === 'p3' ? 1024 : BUDGET))
  queued.forEach((each) => heap.push(each))
  const slots = queued.map((each) => each.slot)
  // p0, p3, p6, p9 come first (priority 0); only p3 fits beside a transfer already holding bytes.
  const found = heap.first((each) => 1024 + each.bytes <= BUDGET)
  assert.equal(found?.url, 'p3')
  assert.deepEqual(
    queued.map((each) => each.slot),
    slots,
    'every job stays where it was',
  )
  assert.equal(takeAdmissible(heap, 1, 1024, BUDGET)?.url, 'p3')
})
