// Streaming lookup oracles, copied as-is.
import type { Job } from '../../../packages/sdk-browser/src/geometry/streaming/types.ts'

/**
 * `packages/sdk-browser/src/geometry/streaming/queue.ts`: a request still in the queue, whose last consumer withdraws, was
 * found by a sweep of the whole queue, then removed by shifting the array.
 */
export function referenceRetireDeLaFile(queue: Job[], job: Job) {
  const at = queue.indexOf(job)
  if (at >= 0) queue.splice(at, 1)
}
