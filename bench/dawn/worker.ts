// The browser's module `Worker` over Node's threads: the engine starts its physics, animation and
// page workers with `new Worker(url, { type: 'module' })` (`host/besideModule.ts`), unchanged here.
// The bench can wait for them all to be idle (`settleWorkers`): a frame then never starts while a
// worker is still answering the last one, whatever this machine's speed — the same frame sees the
// same answers on every play.
import { setTimeout as sleep } from 'node:timers/promises'
import { Worker as Thread } from 'node:worker_threads'

/** The workers alive on this thread. */
const live = new Set<NodeWorker>()

const BOOT = new URL('./workerBoot.ts', import.meta.url)

/** An event of a worker's port: `data` for a message, `error` for a failure. */
class PortEvent extends Event {
  readonly data: unknown
  readonly error: unknown
  constructor(type: string, data?: unknown, error?: unknown) {
    super(type)
    this.data = data
    this.error = error
  }
  get message() {
    return this.error instanceof Error ? this.error.message : String(this.error)
  }
}

/** One module worker on a Node thread, as the page's `Worker` answers. */
class NodeWorker extends EventTarget {
  onmessage: ((event: PortEvent) => void) | null = null
  onerror: ((event: PortEvent) => void) | null = null
  onmessageerror: ((event: PortEvent) => void) | null = null
  readonly #thread: Thread
  /** Messages sent to the worker and heard from it: what `settleWorkers` reads as activity. */
  posted = 0
  heard = 0

  constructor(url: URL | string) {
    super()
    const search = globalThis.location?.search ?? ''
    this.#thread = new Thread(BOOT, { workerData: { url: String(url), search } })
    live.add(this)
    this.#thread.on('exit', () => live.delete(this))
    this.#thread.on('message', (data) => {
      this.heard++
      this.#emit(new PortEvent('message', data))
    })
    this.#thread.on('messageerror', (error) =>
      this.#emit(new PortEvent('messageerror', null, error)),
    )
    this.#thread.on('error', (error) => {
      // A page that misses its worker's error waits for ever: the bench says it.
      console.error(`BENCH_WORKER: ${String(url)}: ${error instanceof Error ? error.stack : error}`)
      this.#emit(new PortEvent('error', null, error))
    })
  }

  #emit(event: PortEvent) {
    const handler =
      event.type === 'message'
        ? this.onmessage
        : event.type === 'error'
          ? this.onerror
          : this.onmessageerror
    handler?.call(this, event)
    this.dispatchEvent(event)
  }

  postMessage(data: unknown, transfer?: Transferable[] | { transfer?: Transferable[] }) {
    const list = Array.isArray(transfer) ? transfer : transfer?.transfer
    this.posted++
    this.#thread.postMessage(data, list as never)
  }

  /** The worker thread's busy time so far, ms. */
  get busyMs() {
    return this.#thread.performance.eventLoopUtilization().active
  }

  terminate() {
    live.delete(this)
    void this.#thread.terminate()
  }
}

/** The messages that went both ways between this thread and its workers. */
const messages = () => [...live].reduce((sum, worker) => sum + worker.posted + worker.heard, 0)
/** Their busy time so far, ms. */
const busy = () => [...live].reduce((sum, worker) => sum + worker.busyMs, 0)
/** The messages counted when the workers were last seen idle. */
let settled = 0

/** A worker at rest still wakes for its timers and its collector: under this share of the time
 *  busy, with no message exchanged, the workers are idle. */
const IDLE_SHARE = 0.05

/**
 * Waits until every worker this thread started is idle — no message exchanged and under
 * `IDLE_SHARE` of the time busy over `quietMs` — or `maxMs` passed; at once when no message went
 * either way since they were last idle. Resolves to the time waited, ms.
 */
export async function settleWorkers(quietMs = 2, maxMs = 50) {
  if (!live.size || messages() === settled) return 0
  const start = performance.now()
  let heard = messages(),
    spent = busy()
  while (performance.now() - start < maxMs) {
    await sleep(quietMs)
    const [nowHeard, nowSpent] = [messages(), busy()]
    if (nowHeard === heard && nowSpent - spent < IDLE_SHARE * quietMs) break
    ;[heard, spent] = [nowHeard, nowSpent]
  }
  settled = messages()
  return performance.now() - start
}

/** Installs the `Worker` once on this thread's global. */
export function installWorker() {
  if (globalThis.Worker !== (NodeWorker as unknown)) globalThis.Worker = NodeWorker as never
}
