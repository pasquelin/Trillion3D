import type { Job, StreamContext } from './types.ts'

/** Admits `job` to a transfer and starts its read; when it settles the transfer is released, the
 *  page's hold ended (`end`), the cache trimmed (`evict`) and the queue pumped again. */
export function startTransfer(
  context: StreamContext,
  loadOne: (url: string, signal: AbortSignal) => Promise<Uint8Array>,
  job: Job,
  settled: { end: (url: string, job: Job) => void; evict: () => void; pump: () => void },
) {
  const { state, catalog, maxTransferBytes, emit } = context
  job.state = 'active'
  state.active++
  state.activeBytes += catalog.get(job.url)!.bytes
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
      state.activeBytes -= catalog.get(job.url)!.bytes
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
