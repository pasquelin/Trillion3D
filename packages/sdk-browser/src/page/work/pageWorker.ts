import {
  PAGE_TASK_PROTOCOL,
  type PageTaskRequest,
} from '../../../../sdk-core/src/page/taskContracts.ts'
import { runPageTask } from './task.ts'
import { type WorkerScope } from '../../host/workerScope.ts'

/**
 * Entry point of the page worker. Platform adapter: this file is loaded only in a module
 * `Worker`, and it contains no decision — it receives a contract message, calls the shared
 * task, and returns its answer with its buffers transferred: the main thread receives the
 * worker's own buffers, never a copy (#982).
 *
 */
const scope = globalThis as unknown as WorkerScope

scope.onmessage = async (event) => {
  const request = event.data as PageTaskRequest
  if (!request || request.protocol !== PAGE_TASK_PROTOCOL) return
  const { answer, transfer } = await runPageTask(request)
  scope.postMessage(answer, transfer)
}
