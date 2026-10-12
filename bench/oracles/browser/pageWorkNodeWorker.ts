/**
 * The fakes a pool is proved against: a worker dead from construction, one that dies after its
 * first answer, and the shim that installs a `Worker` for the length of a run. The real worker on
 * a Node thread is `bench/kit/worker.ts`.
 */
import { PortEvent } from '../../kit/worker.ts'

type NodeWorkerHandler = ((event: PortEvent) => void) | null

/** A worker dead from construction: the startup failure the pool must absorb. */
export class DeadNodeWorker {
  onmessage: NodeWorkerHandler = null
  onerror: NodeWorkerHandler = null
  onmessageerror: NodeWorkerHandler = null
  constructor() {
    queueMicrotask(() => this.onerror?.(new PortEvent('error')))
  }
  postMessage() {}
  terminate() {}
}

/** A page task request, the only message the pool ever posts. */
interface PoolMessage {
  protocol: unknown
  id: unknown
}

/** Answers the very first request successfully, whatever its contents, then dies before answering
 *  the next: the pool breaks once it has served. */
export class FlakyNodeWorker {
  onmessage: NodeWorkerHandler = null
  onerror: NodeWorkerHandler = null
  onmessageerror: NodeWorkerHandler = null
  #count = 0
  postMessage(message: PoolMessage) {
    this.#count++
    if (this.#count === 1) {
      queueMicrotask(() =>
        this.onmessage?.(
          new PortEvent('message', {
            protocol: message.protocol,
            id: message.id,
            ok: true,
            taskMs: 0,
          }),
        ),
      )
    } else queueMicrotask(() => this.onerror?.(new PortEvent('error')))
  }
  terminate() {}
}

/** A worker constructor as this bridge fakes it: enough of `Worker` for the pool to construct,
 *  message and terminate one, never the rest of the DOM interface. */
export interface NodeWorkerLike {
  new (url: URL): {
    onmessage: NodeWorkerHandler
    onerror: NodeWorkerHandler
    onmessageerror: NodeWorkerHandler
    postMessage(message: unknown, transfer?: Transferable[]): void
    terminate(): unknown
  }
}

/** Installs `globalThis.Worker` for the duration of `run`, and always removes it afterwards. */
export async function withNodeWorkerShim<T>(
  implementation: NodeWorkerLike,
  run: () => Promise<T>,
): Promise<T> {
  const precedent = globalThis.Worker
  globalThis.Worker = implementation as typeof Worker
  try {
    return await run()
  } finally {
    if (precedent === undefined) delete (globalThis as { Worker?: typeof Worker }).Worker
    else globalThis.Worker = precedent
  }
}
