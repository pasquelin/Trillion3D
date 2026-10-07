import { besideModule, startModuleWorker } from '../../host/besideModule.ts'
import { PAGE_DECODE_PROTOCOL } from '../../../../sdk-core/src/index.ts'
import type { PageDecodeAnswer, PageDecodeRequest } from '../../../../sdk-core/src/index.ts'

type Waiting = {
  request: PageDecodeRequest
  transfer: ArrayBuffer[]
  settle: (answer: PageDecodeAnswer) => void
}
const workerError = (id: number): PageDecodeAnswer => ({
  protocol: PAGE_DECODE_PROTOCOL,
  id,
  ok: false,
  code: 'PAGE_DECODE_WORKER',
  message: 'PAGE_DECODE_WORKER',
})

/**
 * A bounded pool of module workers, one job at a time per worker, the rest queued. Browser
 * adapter: this is the only file that constructs a `Worker`.
 *
 * `ready` is the startup gate: the first worker receives a probe request, and until its answer
 * has come back, no real buffer is transferred. A start that fails — no `Worker`, module not
 * found, `crypto` missing — therefore leaves the caller with its bytes intact and its
 * synchronous fallback. After start, a worker's disappearance breaks the pool: in-flight work
 * answers `PAGE_DECODE_WORKER`, and everything after that goes back to the fallback.
 *
 * A decoded page comes back by transfer: the main thread receives the worker's own buffer, with
 * no copy on either side.
 */
export function createPageDecodePool(size: number) {
  const idle: Worker[] = [],
    all: Worker[] = [],
    queue: Waiting[] = []
  const pending = new Map<number, Waiting>(),
    owner = new Map<number, Worker>()
  let nextId = 1,
    alive = true,
    retired = false
  const source = besideModule('pageDecodeWorker', import.meta.url)
  const spawn = () => {
    const worker = startModuleWorker(source)
    worker.onmessage = (event: MessageEvent) => receive(worker, event.data as PageDecodeAnswer)
    worker.onerror = () => breakPool()
    worker.onmessageerror = () => breakPool()
    all.push(worker)
    return worker
  }
  const receive = (worker: Worker, answer: PageDecodeAnswer) => {
    const waiting = pending.get(answer.id)
    pending.delete(answer.id)
    owner.delete(answer.id)
    idle.push(worker)
    waiting?.settle(answer)
    if (retired) drain()
    else pump()
  }
  /** A retired pool's step: the work it was given before retiring — queued included — goes on to
   *  its workers, a worker left with none stops, and the pool closes once nothing is left. */
  const drain = () => {
    pump()
    for (const worker of idle.splice(0)) worker.terminate()
    if (!pending.size && !queue.length) breakPool()
  }
  const breakPool = () => {
    if (!alive) return
    alive = false
    const lost = [...pending.values(), ...queue.splice(0)]
    pending.clear()
    owner.clear()
    idle.length = 0
    for (const worker of all.splice(0)) worker.terminate()
    for (const waiting of lost) waiting.settle(workerError(waiting.request.id))
  }
  const pump = () => {
    while (alive && queue.length && (idle.length || all.length < size)) {
      const waiting = queue.shift()!
      const worker = idle.pop() ?? spawn()
      pending.set(waiting.request.id, waiting)
      owner.set(waiting.request.id, worker)
      try {
        worker.postMessage(waiting.request, waiting.transfer)
      } catch {
        breakPool()
        return
      }
    }
  }
  const submit = (
    op: PageDecodeRequest['op'],
    source: ArrayBuffer,
    maxDecodedBytes: number,
    name?: string,
    spans?: number[],
  ) => {
    const request: PageDecodeRequest = {
      protocol: PAGE_DECODE_PROTOCOL,
      id: nextId++,
      op,
      source,
      maxDecodedBytes,
      ...(name === undefined ? {} : { name }),
      ...(spans === undefined ? {} : { spans }),
    }
    if (!alive || retired)
      return { id: request.id, answer: Promise.resolve(workerError(request.id)) }
    const answer = new Promise<PageDecodeAnswer>((resolve) => {
      queue.push({ request, transfer: [source], settle: resolve })
      pump()
    })
    return { id: request.id, answer }
  }
  let ready: Promise<boolean> | undefined
  return {
    get alive() {
      return alive
    },
    get workers() {
      return size
    },
    /** True once a worker has answered the startup probe; false and the pool closed otherwise. */
    start() {
      ready ??= (async () => {
        try {
          const answer = await submit('verify', new ArrayBuffer(8), 0).answer
          if (!answer.ok) breakPool()
          return answer.ok
        } catch {
          breakPool()
          return false
        }
      })()
      return ready
    },
    submit,
    /** Asks to drop a request still in the queue. No effect on a decode already begun. */
    cancel(id: number) {
      const worker = owner.get(id)
      if (!alive || !worker) return
      try {
        worker.postMessage({ protocol: PAGE_DECODE_PROTOCOL, id, op: 'cancel' }, [])
      } catch {
        breakPool()
      }
    },
    /** Closes the pool without cutting the work it was given, queued or in flight: it takes no
     *  more, finishes that, and its workers stop as they run out of it. */
    retire() {
      retired = true
      drain()
    },
  }
}
export type PageDecodePool = ReturnType<typeof createPageDecodePool>
