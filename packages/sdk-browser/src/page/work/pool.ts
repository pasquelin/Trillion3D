import { besideModule, startModuleWorker } from '../../host/besideModule.ts'
import { createPendingAnswers, workerRefusal } from '../../host/pendingAnswers.ts'
import {
  PAGE_TASK_PROTOCOL,
  type PageTaskAnswer,
  type PageTaskRequest,
} from '../../../../sdk-core/src/page/taskContracts.ts'

type Waiting = { request: PageTaskRequest; transfer: ArrayBuffer[] }
const workerError = (id: number): PageTaskAnswer =>
  workerRefusal(PAGE_TASK_PROTOCOL, 'PAGE_TASK_WORKER', id)

/** A pool's workers and the work they hold: idle, all, queued, and the answers owed. */
type Pool = {
  readonly size: number
  readonly source: URL | string
  readonly idle: Worker[]
  readonly all: Worker[]
  readonly queue: Waiting[]
  readonly answers: ReturnType<typeof createPendingAnswers<PageTaskAnswer>>
  alive: boolean
  retired: boolean
}

/** A worker's failure breaks the pool: its work in flight and queued answers `PAGE_TASK_WORKER`. */
function breakPool(pool: Pool) {
  if (!pool.alive) return
  pool.alive = false
  pool.queue.length = 0
  pool.idle.length = 0
  for (const worker of pool.all.splice(0)) worker.terminate()
  pool.answers.refuseAll()
}

/** A retired pool's step: the work it was given before retiring — queued included — goes on to
 *  its workers, a worker left with none stops, and the pool closes once nothing is left. */
function drain(pool: Pool) {
  pump(pool)
  for (const worker of pool.idle.splice(0)) worker.terminate()
  if (!pool.answers.size) breakPool(pool)
}

function receive(pool: Pool, worker: Worker, answer: PageTaskAnswer) {
  pool.idle.push(worker)
  pool.answers.answer(answer)
  if (pool.retired) drain(pool)
  else pump(pool)
}

function spawn(pool: Pool) {
  const worker = startModuleWorker(pool.source)
  worker.onmessage = (event: MessageEvent) => receive(pool, worker, event.data as PageTaskAnswer)
  worker.onerror = () => breakPool(pool)
  worker.onmessageerror = () => breakPool(pool)
  pool.all.push(worker)
  return worker
}

/** Hands the queued work to idle workers, starting one while the pool has room. */
function pump(pool: Pool) {
  const { queue, idle, all } = pool
  while (pool.alive && queue.length && (idle.length || all.length < pool.size)) {
    const waiting = queue.shift()!
    const worker = idle.pop() ?? spawn(pool)
    try {
      worker.postMessage(waiting.request, waiting.transfer)
    } catch {
      breakPool(pool)
      return
    }
  }
}

/**
 * A bounded pool of module workers, one job at a time per worker, the rest queued. Browser
 * adapter: this is the only file that constructs a `Worker`. A worker is started by the first job
 * that finds none idle, never ahead of one.
 *
 * A worker that fails — no module, a start refused, an error later — breaks the pool: the work in
 * flight and queued answers `PAGE_TASK_WORKER`, and so does everything submitted after it. Its
 * caller sends a copy of its bytes and runs the same task on the main thread for that answer
 * (`host.ts`), so a broken pool loses no work.
 *
 * A task's buffers come back by transfer: the main thread receives the worker's own, with no copy
 * on either side (#982).
 */
export function createPageWorkPool(size: number) {
  const pool: Pool = {
    size,
    source: besideModule('pageWorker', import.meta.url),
    ...{ idle: [], all: [], queue: [], answers: createPendingAnswers(workerError) },
    alive: true,
    retired: false,
  }
  let nextId = 1
  return {
    get alive() {
      return pool.alive
    },
    get workers() {
      return size
    },
    submit(op: PageTaskRequest['op'], source: ArrayBuffer, name?: string) {
      const request: PageTaskRequest = {
        protocol: PAGE_TASK_PROTOCOL,
        id: nextId++,
        op,
        source,
        ...(name === undefined ? {} : { name }),
      }
      if (!pool.alive || pool.retired) return Promise.resolve(workerError(request.id))
      return new Promise<PageTaskAnswer>((resolve) => {
        pool.answers.expect(request.id, resolve)
        pool.queue.push({ request, transfer: [source] })
        pump(pool)
      })
    },
    /** Closes the pool without cutting the work it was given, queued or in flight: it takes no
     *  more, finishes that, and its workers stop as they run out of it. */
    retire() {
      pool.retired = true
      drain(pool)
    },
  }
}
export type PageWorkPool = ReturnType<typeof createPageWorkPool>
