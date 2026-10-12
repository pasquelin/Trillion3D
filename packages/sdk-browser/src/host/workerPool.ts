import { startModuleWorker } from './besideModule.ts'
import { createPendingAnswers } from './pendingAnswers.ts'

/** A request a pool's worker answers: its id names the answer. */
type Request = { id: number }

/** A request waiting for a worker, with the buffers it hands over. */
type Waiting<Q> = { request: Q; transfer: Transferable[] }

/** A worker and the requests it holds, posted and not yet answered. */
type Slot = { worker: Worker; held: number }

/** A pool's workers and the work they hold: all, queued, and the answers owed. */
type Pool<Q extends Request, A extends Request> = {
  readonly size: number
  readonly depth: number
  readonly source: URL | string
  readonly slots: Slot[]
  readonly queue: Waiting<Q>[]
  readonly answers: ReturnType<typeof createPendingAnswers<A>>
  alive: boolean
  retired: boolean
}

/** A worker's failure breaks the pool: its work in flight and queued answers the refusal. */
function breakPool<Q extends Request, A extends Request>(pool: Pool<Q, A>) {
  if (!pool.alive) return
  pool.alive = false
  pool.queue.length = 0
  for (const slot of pool.slots.splice(0)) slot.worker.terminate()
  pool.answers.refuseAll()
}

/** A retired pool's step: the work it was given before retiring — queued included — goes on to
 *  its workers, a worker left with none stops, and the pool closes once nothing is left. */
function drain<Q extends Request, A extends Request>(pool: Pool<Q, A>) {
  pump(pool)
  for (let i = pool.slots.length - 1; i >= 0; i--)
    if (!pool.slots[i].held) pool.slots.splice(i, 1)[0].worker.terminate()
  if (!pool.answers.size) breakPool(pool)
}

function receive<Q extends Request, A extends Request>(pool: Pool<Q, A>, slot: Slot, answer: A) {
  slot.held--
  pool.answers.answer(answer)
  if (pool.retired) drain(pool)
  else pump(pool)
}

function spawn<Q extends Request, A extends Request>(pool: Pool<Q, A>) {
  const slot: Slot = { worker: startModuleWorker(pool.source), held: 0 }
  slot.worker.onmessage = (event: MessageEvent) => receive(pool, slot, event.data as A)
  slot.worker.onerror = () => breakPool(pool)
  slot.worker.onmessageerror = () => breakPool(pool)
  pool.slots.push(slot)
  return slot
}

/** The worker the next request goes to: the one holding least while under `depth`, else a new
 *  one while the pool has room, else none — the request waits. */
function nextSlot<Q extends Request, A extends Request>(pool: Pool<Q, A>) {
  let best: Slot | undefined
  for (const slot of pool.slots)
    if (slot.held < pool.depth && slot.held < (best?.held ?? Infinity)) best = slot
  if (best?.held === 0 || pool.slots.length >= pool.size) return best
  return spawn(pool)
}

/** Hands the queued work to the workers that can take it, starting one while the pool has room. */
function pump<Q extends Request, A extends Request>(pool: Pool<Q, A>) {
  const { queue } = pool
  while (pool.alive && queue.length) {
    let slot: Slot | undefined
    try {
      slot = nextSlot(pool)
    } catch {
      // A worker the platform cannot start — no `Worker`, a module refused — breaks the pool.
      breakPool(pool)
      return
    }
    if (!slot) return
    const waiting = queue.shift()!
    try {
      slot.worker.postMessage(waiting.request, waiting.transfer)
    } catch {
      breakPool(pool)
      return
    }
    slot.held++
  }
}

/**
 * THE ENGINE'S WORKER HOST: a bounded pool of module workers on `source`, the rest queued in send
 * order. Browser adapter: this is the only file of the page work that constructs a `Worker`. A
 * worker is started by the first request that finds none to take it, never ahead of one.
 *
 * `depth` is how many requests a worker holds at once. One spreads the work over the pool, each
 * request going to a worker that is free; a pool of one with no bound posts every request at once,
 * so its worker runs them back to back, in send order, with no round trip between two.
 *
 * A worker that fails — no module, a start refused, an error later — breaks the pool: the work in
 * flight and queued answers `refusal`, and so does everything submitted after it. Its caller runs
 * the same task on the main thread for that answer, so a broken pool loses no work.
 */
export function createWorkerPool<Q extends Request, A extends Request>(options: {
  source: URL | string
  size: number
  depth: number
  refusal: (id: number) => A
}) {
  const pool: Pool<Q, A> = {
    ...{ size: options.size, depth: options.depth, source: options.source },
    ...{ slots: [], queue: [], answers: createPendingAnswers(options.refusal) },
    alive: true,
    retired: false,
  }
  let nextId = 1
  return {
    get alive() {
      return pool.alive
    },
    get workers() {
      return pool.size
    },
    /** `request` sent under the next id, `transfer` handed over with it. */
    submit(request: Omit<Q, 'id'>, transfer: Transferable[] = []) {
      const id = nextId++
      if (!pool.alive || pool.retired) return Promise.resolve(options.refusal(id))
      return new Promise<A>((resolve) => {
        pool.answers.expect(id, resolve)
        pool.queue.push({ request: { ...request, id } as Q, transfer })
        pump(pool)
      })
    },
    /** Closes the pool without cutting the work it was given, queued or in flight: it takes no
     *  more, finishes that, and its workers stop as they run out of it. */
    retire() {
      pool.retired = true
      drain(pool)
    },
    /** Closes the pool now: its workers stop, and the work it holds answers `refusal`. */
    close() {
      breakPool(pool)
    },
  }
}
export type WorkerPool<Q extends Request, A extends Request> = ReturnType<
  typeof createWorkerPool<Q, A>
>
