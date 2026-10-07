import {
  PAGE_TASK_PROTOCOL,
  type PageTaskRequest,
} from '../../../../sdk-core/src/page/taskContracts.ts'
import { runPageTask } from './task.ts'

/**
 * Entry point of the page worker. Platform adapter: this file is loaded only in a module
 * `Worker`, and it contains no decision — it receives a contract message, calls the shared
 * task, and returns its answer with its buffers transferred: the main thread receives the
 * worker's own buffers, never a copy (#982).
 *
 * A dedicated worker's scope is not typed by the repository's DOM library; the minimal shape
 * this file needs is declared here rather than adding a whole library.
 */
type PageWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
}

const scope = globalThis as unknown as PageWorkerScope

scope.onmessage = async (event) => {
  const request = event.data as PageTaskRequest
  if (!request || request.protocol !== PAGE_TASK_PROTOCOL) return
  const { answer, transfer } = await runPageTask(request)
  scope.postMessage(answer, transfer)
}
