// Lot H2: the page-task host — a page's digest taken where it lands, the pool cap, and `null`
// metrics until something is measured. Hostile inputs: a dead worker, a worker that vanishes after
// its first answer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pageWorkerCount } from '../../../../sdk-core/src/page/taskContracts.ts'
import {
  configurePageWorkers,
  pageWorkStats,
  patientTask,
  releasePageWorkers,
  verifyPageBytes,
} from './host.ts'
import {
  DeadNodeWorker,
  FlakyNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from '../../../../../bench/oracles/browser/pageWorkNodeWorker.ts'

/** A cell file of no node: the smallest task a worker reads whole. */
const emptyCells = () => new TextEncoder().encode(JSON.stringify({ version: 2, nodes: [] }))

function withCores<T>(n: number, run: () => Promise<T>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: { hardwareConcurrency: n },
    configurable: true,
  })
  return run().finally(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous)
  })
}

test('with no check, the counts are null, not zero, and no pool is open', () => {
  releasePageWorkers()
  assert.deepEqual(pageWorkStats(), { checked: null, checkMs: null, workers: null })
})

test('a page is checked where it landed: its digest, its bytes untouched, counted', async () => {
  releasePageWorkers()
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const view = new Uint8Array([9, ...bytes, 9]).subarray(1, 9)
  const expected = createHash('sha256').update(bytes).digest('hex')
  assert.equal(await verifyPageBytes(bytes.slice().buffer), expected)
  assert.equal(await verifyPageBytes(view), expected, 'a view is hashed over its own bytes')
  assert.deepEqual([...view], [...bytes], 'the bytes stay where they were')
  const { checked, checkMs, workers } = pageWorkStats()
  assert.equal(checked, 2)
  assert.ok(checkMs! >= 0)
  assert.equal(workers, null, 'a check opens no worker')
  releasePageWorkers()
})

test('pool size is bounded by cores, the cap and admission, and is readable in the metrics', () =>
  withNodeWorkerShim(NodeDomWorker, () =>
    withCores(8, async () => {
      releasePageWorkers()
      configurePageWorkers(2)
      const answer = await patientTask('cells', emptyCells())
      assert.equal(answer.ok, true)
      assert.equal(pageWorkStats().workers, pageWorkerCount(8, 2))
      releasePageWorkers()
    }),
  ))

test('a worker dead at start never loses a task: the main thread reads it', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeDomWorker, async () => {
    releasePageWorkers()
    configurePageWorkers(1)
    assert.equal((await patientTask('cells', emptyCells())).ok, true)
    assert.equal(pageWorkStats().workers, 0, 'the broken pool is told as no worker')
    assert.equal((await patientTask('cells', emptyCells())).ok, true)
    releasePageWorkers()
  }))

test('a task whose worker vanished is read on the main thread from the bytes it kept', () =>
  withNodeWorkerShim(FlakyNodeWorker as unknown as typeof NodeDomWorker, async () => {
    releasePageWorkers()
    configurePageWorkers(1)
    await patientTask('cells', emptyCells()) // the one answer the flaky worker gives
    const source = emptyCells()
    const answer = await patientTask('cells', source)
    assert.equal(answer.ok, true)
    assert.ok(answer.ok && answer.cells?.nodes === 0)
    assert.equal(source.byteLength, emptyCells().byteLength, 'the worker took a copy')
    releasePageWorkers()
  }))
