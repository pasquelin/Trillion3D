// Batch H2: the bounded pool of module workers, proved with real `worker_threads` threads
// behind `NodeDomWorker`. Hostile inputs: a runner dead on construction, a runner that dies
// after its first answer, a pool retired with work queued.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageWorkPool } from './pool.ts'
import {
  DeadNodeWorker,
  FlakyNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from '../../../../../bench/oracles/browser/pageWorkNodeWorker.ts'

/** A task every worker answers at once: two bytes hold no cell file, a refusal comes back. */
const short = () => new ArrayBuffer(2)
const codeOf = (answer: unknown) => (answer as { code?: string }).code

test('a runner dead on construction answers PAGE_TASK_WORKER without ever blocking', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const pool = createPageWorkPool(2)
    assert.equal(codeOf(await pool.submit('cells', short())), 'PAGE_TASK_WORKER')
    assert.equal(pool.alive, false)
  }))

test('a runner that dies after its first answer answers PAGE_TASK_WORKER to the next job', () =>
  withNodeWorkerShim(FlakyNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const pool = createPageWorkPool(1)
    assert.equal((await pool.submit('cells', short())).ok, true, 'the first answer must succeed')
    assert.equal(pool.alive, true)
    assert.equal(codeOf(await pool.submit('cells', short())), 'PAGE_TASK_WORKER')
    assert.equal(pool.alive, false, 'the pool must be broken after the worker dies')
    // A dead pool answers at once, without ever trying a new runner.
    assert.equal(codeOf(await pool.submit('cells', short())), 'PAGE_TASK_WORKER')
  }))

test('a retired pool finishes the work it was given, the queued too, then closes', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const pool = createPageWorkPool(1)
    // One worker: the second task waits in the queue when the pool retires — a session closing
    // while the cells it asked are still being read.
    const first = pool.submit('cells', short())
    const queued = pool.submit('cells', short())
    pool.retire()
    assert.equal(codeOf(await first), 'PAGE_TASK_FAILED', 'the worker read the first task')
    assert.equal(codeOf(await queued), 'PAGE_TASK_FAILED', 'the retirement dropped queued work')
    assert.equal(pool.alive, false, 'the pool closes once its work is done')
    // A retired pool takes no new work: its caller does it on the main thread.
    assert.equal(codeOf(await pool.submit('cells', short())), 'PAGE_TASK_WORKER')
  }))
