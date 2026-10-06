import { PAGE_DECODE_PROTOCOL } from '../../../../sdk-core/src/index.ts'
import { runPageDecodeTask } from './task.ts'
import type { PageDecodeCancel, PageDecodeRequest } from '../../../../sdk-core/src/index.ts'

/**
 * Entry point of the decode worker. Platform adapter: this file is loaded only in a module
 * `Worker`, and it contains no decision — it receives a contract message, calls the shared
 * task, and returns its answer with its buffers transferred: the main thread receives the
 * worker's own decoded block, never a copy (#982).
 *
 * A dedicated worker's scope is not typed by the repository's DOM library; the minimal shape
 * this file needs is declared here rather than adding a whole library.
 */
type DecodeWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
}

const scope = globalThis as unknown as DecodeWorkerScope
/** Requests cancelled before they started. A decode already begun has no stop point: it goes
 *  to its end, and it is the answer that becomes a cancel. */
const cancelled = new Set<number>()

scope.onmessage = async (event) => {
  const message = event.data as PageDecodeRequest | PageDecodeCancel
  if (!message || message.protocol !== PAGE_DECODE_PROTOCOL) return
  if (message.op === 'cancel') {
    cancelled.add(message.id)
    return
  }
  const request = message as PageDecodeRequest
  if (cancelled.delete(request.id)) {
    scope.postMessage(
      {
        protocol: PAGE_DECODE_PROTOCOL,
        id: request.id,
        ok: false,
        code: 'PAGE_DECODE_CANCELLED',
        message: 'PAGE_DECODE_CANCELLED',
      },
      [],
    )
    return
  }
  const { answer, transfer } = await runPageDecodeTask(request)
  cancelled.delete(request.id)
  scope.postMessage(answer, transfer)
}
