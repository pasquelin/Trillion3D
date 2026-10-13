import { besideModule } from '../../host/besideModule.ts'
import { workerRefusal } from '../../host/pendingAnswers.ts'
import { createWorkerPool } from '../../host/workerPool.ts'
import { PAGE_INTEGRATION_PROTOCOL } from '../../../../sdk-core/src/index.ts'
import type {
  PageIntegrationAnswer,
  PageIntegrationRequest,
} from '../../../../sdk-core/src/index.ts'

/**
 * The integration lane: the engine's worker host (`../../host/workerPool.ts`) as a pool of one
 * that posts every request at once, so its worker plans them back to back, in send order.
 *
 * One thread, not a pool: the integration order IS the frame's priority, and two threads would
 * return their plans in the order of their load. The work planned here is integer arithmetic
 * on a few hundred records; it is the main thread that must be freed, not one more core that
 * must be occupied.
 *
 * `start` is the startup gate: a probe request goes first, and a start that fails — no
 * `Worker`, module not found — leaves the caller to its in-line fallback. After start, the
 * worker's disappearance breaks the lane: in-flight work answers `PAGE_INTEGRATION_WORKER`,
 * and everything after that goes back in-line.
 */
export function createPageIntegrationLane() {
  const pool = createWorkerPool<PageIntegrationRequest, PageIntegrationAnswer>({
    source: besideModule('pageIntegrationWorker', import.meta.url),
    size: 1,
    depth: Infinity,
    refusal: (id) => ({
      ...workerRefusal(PAGE_INTEGRATION_PROTOCOL, 'PAGE_INTEGRATION_WORKER', id),
      url: '',
    }),
  })
  const submit = (url: string, words: number, specs: ArrayBuffer | null) =>
    pool.submit({ protocol: PAGE_INTEGRATION_PROTOCOL, url, words, specs }, specs ? [specs] : [])
  let ready: Promise<boolean> | undefined
  return {
    get alive() {
      return pool.alive
    },
    /** True once the worker has answered the startup probe; false and the lane closed otherwise. */
    start() {
      ready ??= submit('', 0, new Int32Array(0).buffer as ArrayBuffer).then((answer) => {
        if (!answer.ok) pool.close()
        return answer.ok
      })
      return ready
    },
    submit,
    retire: pool.close,
  }
}
