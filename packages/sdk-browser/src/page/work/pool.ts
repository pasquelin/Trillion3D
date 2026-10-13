import { besideModule } from '../../host/besideModule.ts'
import { workerRefusal } from '../../host/pendingAnswers.ts'
import { createWorkerPool } from '../../host/workerPool.ts'
import {
  PAGE_TASK_PROTOCOL,
  type PageTaskAnswer,
  type PageTaskRequest,
} from '../../../../sdk-core/src/page/taskContracts.ts'

/**
 * The page tasks' pool (`../../host/workerPool.ts`): `size` workers, one task at a time each, so
 * a task goes to a worker that is free. A lost worker answers `PAGE_TASK_WORKER`, and its caller
 * runs the same task on the main thread (`host.ts`).
 *
 * A task's buffers come back by transfer: the main thread receives the worker's own, with no copy
 * on either side (#982).
 */
export function createPageWorkPool(size: number) {
  const pool = createWorkerPool<PageTaskRequest, PageTaskAnswer>({
    source: besideModule('pageWorker', import.meta.url),
    size,
    depth: 1,
    refusal: (id) => workerRefusal(PAGE_TASK_PROTOCOL, 'PAGE_TASK_WORKER', id),
  })
  return {
    get alive() {
      return pool.alive
    },
    get workers() {
      return pool.workers
    },
    submit: (op: PageTaskRequest['op'], source: ArrayBuffer, name?: string) =>
      pool.submit(
        { protocol: PAGE_TASK_PROTOCOL, op, source, ...(name === undefined ? {} : { name }) },
        [source],
      ),
    retire: pool.retire,
  }
}
export type PageWorkPool = ReturnType<typeof createPageWorkPool>
