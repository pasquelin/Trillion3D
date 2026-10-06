import type { Job, StreamContext } from './types.ts'
import { takeAdmissible } from './queueOrder.ts'

/** Admits `job` to a transfer and starts its read; when it settles the transfer is released, the
 *  page's hold ended (`end`), the cache trimmed (`evict`) and the queue pumped again. */
function startTransfer(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  job: Job,
  settled: { end: (url: string, job: Job) => void; evict: () => void; pump: () => void },
) {
  const { state, maxTransferBytes, emit } = context
  job.state = 'active'
  state.active++
  state.activeBytes += job.bytes
  emit?.('page-transfer-start', 'Page transfer admitted', () => ({
    version: 1,
    url: job.url,
    active: state.active,
    transferInFlightBytes: state.activeBytes,
    maxTransferBytes,
  }))
  void loadOne(job.url, job.controller.signal)
    .then(job.resolve, job.reject)
    .finally(() => {
      state.active--
      state.activeBytes -= job.bytes
      settled.end(job.url, job)
      emit?.('page-transfer-end', 'Page transfer finished', () => ({
        version: 1,
        url: job.url,
        active: state.active,
        transferInFlightBytes: state.activeBytes,
      }))
      settled.evict()
      settled.pump()
    })
}

/** The queue's pump: its jobs start in its order while a transfer is free and the bytes in flight
 *  admit them (`takeAdmissible`), each settled transfer ending through `end` and pumping again. */
export function createPump(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  end: (url: string, job: Job) => void,
  evict: () => void,
) {
  const { state, abort, limit, queue, maxTransferBytes } = context
  const pump = () => {
    if (state.disposed || abort.signal.aborted) return
    while (state.active < limit) {
      const job = takeAdmissible(queue, state.active, state.activeBytes, maxTransferBytes)
      if (!job) break
      if (job.consumers.size === 0 || job.controller.signal.aborted) continue
      startTransfer(context, loadOne, job, { end, evict, pump })
    }
  }
  return pump
}
