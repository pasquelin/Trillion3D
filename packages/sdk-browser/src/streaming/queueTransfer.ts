import type { Job, StreamContext } from './types.ts'
import { compacteFile, findAdmissible } from './queueOrder.ts'

/** Admits `job` to a transfer and starts its read — its own `load`, else the catalogue page's
 *  (`loadOne`); when it settles the transfer is released, the page's hold ended (`end`), the cache
 *  trimmed (`evict`) and the queue pumped again. */
function startTransfer(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  job: Job,
  settled: { end: (url: string, job: Job) => void; evict: () => void; pump: () => void },
) {
  const { state, maxTransferBytes, emit, abort } = context
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
  const read = job.load
    ? job.load(AbortSignal.any([abort.signal, job.controller.signal]))
    : loadOne(job.url, job.controller.signal)
  void read.then(job.resolve, job.reject).finally(() => {
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
 *  admit them (`findAdmissible`), each settled transfer ending through `end` and pumping again. */
export function createPump(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  end: (url: string, job: Job) => void,
  evict: () => void,
) {
  const { state, abort, limit, queue, jobs, catalog, maxTransferBytes } = context
  const bytesOf = (url: string) => (jobs.get(url) ?? catalog.get(url))?.bytes
  const pump = () => {
    if (state.disposed || abort.signal.aborted) return
    if (state.dropped) {
      compacteFile(queue)
      state.dropped = 0
    }
    // The queue is kept in order by its insertions: it is never sorted. Neither
    // compaction nor removing an admitted job disturbs that order.
    while (state.active < limit && queue.length) {
      const at = findAdmissible(queue, state.active, state.activeBytes, bytesOf, maxTransferBytes)
      if (at < 0) break
      const job = queue.splice(at, 1)[0]
      if (job.consumers.size === 0 || job.controller.signal.aborted) continue
      startTransfer(context, loadOne, job, { end, evict, pump })
    }
  }
  return pump
}
