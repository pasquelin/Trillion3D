import type { Job, StreamContext } from './types.ts'
import type { Landed } from './fetch.ts'

/** How a transfer reads its jobs, ends one, and trims the cache once it settled. */
type Transfers = {
  read: (jobs: readonly Job[], signal: AbortSignal) => Promise<Landed[]>
  end: (url: string, job: Job) => void
  evict: () => void
  /** Whether the page of `url` was forgotten while its job ran. */
  forgotten: (url: string) => boolean
}

/** `job` landed as `landed`: read, it is done; failed, it waits its turn while it may pass and
 *  someone waits on it (`failures.ts`), else it fails, said once. A streamer closed meanwhile
 *  records nothing. */
function settle(context: StreamContext, job: Job, landed: Landed, own: Transfers) {
  const { failures, abort, emit } = context,
    { url } = job
  if (landed.bytes) {
    failures.passed(url)
    own.end(url, job)
    return job.resolve(landed.bytes)
  }
  const recorded = abort.signal.aborted ? undefined : failures.record(url, landed.cause),
    error = String(landed.cause)
  // A page forgotten while it transferred is wanted no more: it ends, never waits.
  if (recorded?.waits && job.askers > 0 && !own.forgotten(url)) {
    job.state = 'waiting'
    return emit?.('page-retry', 'A read that failed waits its turn', () => ({
      ...{ version: 1, url, error },
    }))
  }
  own.end(url, job)
  job.reject(recorded?.error ?? landed.cause)
  if (recorded)
    emit?.('page-error', 'Persistent page-load failure', () => ({
      ...{ version: 1, url, error, sticky: !recorded.waits },
    }))
}

/** Admits `jobs` to one transfer and starts its read; once it settles each job is settled, the
 *  transfer released, the cache trimmed and the queue pumped again. */
function startTransfer(context: StreamContext, jobs: Job[], own: Transfers, pump: () => void) {
  const { state, maxTransferBytes, emit, abort } = context
  let bytes = 0
  for (const job of jobs) {
    job.state = 'active'
    bytes += job.bytes
  }
  state.active++
  state.activeBytes += bytes
  const url = jobs[0].url
  emit?.('page-transfer-start', 'Page transfer admitted', () => ({
    ...{ version: 1, url, pages: jobs.length, active: state.active },
    ...{ transferInFlightBytes: state.activeBytes, maxTransferBytes },
  }))
  void own
    .read(jobs, abort.signal)
    .then(
      (landed) => landed.forEach((each, at) => settle(context, jobs[at], each, own)),
      (cause: unknown) => jobs.forEach((job) => settle(context, job, { cause }, own)),
    )
    .finally(() => {
      state.active--
      state.activeBytes -= bytes
      emit?.('page-transfer-end', 'Page transfer finished', () => ({
        ...{ version: 1, url, active: state.active, transferInFlightBytes: state.activeBytes },
      }))
      own.evict()
      pump()
    })
}

/** The queue's pump: its jobs start in its order while a transfer is free and the bytes in flight
 *  admit them, the ranges end to end in one file merged into one transfer (`queueRanges.ts`). */
export function createPump(context: StreamContext, own: Transfers) {
  const { state, abort, limit, queue, maxTransferBytes } = context
  const pump = () => {
    if (state.disposed || abort.signal.aborted) return
    while (state.active < limit) {
      const jobs = queue.take(state.active, state.activeBytes, maxTransferBytes)
      if (!jobs) break
      startTransfer(context, jobs, own, pump)
    }
  }
  return pump
}
