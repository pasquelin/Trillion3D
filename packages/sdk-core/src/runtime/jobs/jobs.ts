import { disposeOwned } from './jobDisposal.ts'

const noop = () => {}
/** Where a job stands: waiting, running, done, cancelled or failed. */
export type JobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
/** How far a job has got. */
export interface JobProgress {
  /** The step it is in. */
  phase: string
  /** Work done. */
  completed?: number
  /** Work in all. */
  total?: number
  /** Words for a person to read. */
  message?: string
  [key: string]: unknown
}
/** Everything a job is at one moment: its status, progress, result or error. */
export interface JobSnapshot<T> {
  /** Event format version. */
  eventVersion: 1
  /** The job's name. */
  id: string
  /** Where it stands. */
  status: JobStatus
  /** How far it has got. */
  progress: JobProgress | null
  /** What it produced. */
  result: T | null
  /** What went wrong. */
  error: { code: string; message: string } | null
}
/** No timers, DOM, filesystem or UI. Hosts inject work, cancellation and telemetry. */
export function createJob<T>(
  id: string,
  work: (context: { signal: AbortSignal; progress: (event: JobProgress) => void }) => Promise<T>,
  options: {
    signal?: AbortSignal
    telemetry?: (snapshot: JobSnapshot<T>) => void
    disposeResult?: (result: T) => void
  } = {},
) {
  const controller = new AbortController(),
    listeners = new Set<() => void>(),
    // Read once: the caller may reuse or edit its options object while the job runs.
    { signal: external, telemetry = noop, disposeResult = noop } = options
  let snapshot: JobSnapshot<T> = {
    eventVersion: 1,
    id,
    status: 'queued',
    progress: null,
    result: null,
    error: null,
  }
  const publish = (patch: Partial<JobSnapshot<T>>) => {
    snapshot = Object.freeze({ ...snapshot, ...patch })
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* Observers do not own job execution. */
      }
    }
    try {
      telemetry(snapshot)
    } catch {
      /* Telemetry cannot turn successful work into failure. */
    }
  }
  // Only ever listening on, or called for, the external signal.
  const relay = () => controller.abort(external!.reason)
  external?.addEventListener('abort', relay)
  if (external?.aborted) relay()
  const promise = Promise.resolve().then(async () => {
    let result: T | undefined
    try {
      controller.signal.throwIfAborted()
      publish({ status: 'running' })
      result = await work({
        signal: controller.signal,
        progress: (event) => {
          controller.signal.throwIfAborted()
          publish({ progress: event })
        },
      })
      controller.signal.throwIfAborted()
      publish({ status: 'completed', result })
      return result
    } catch (error) {
      // Only work that returned and was then cancelled leaves a result nobody will receive.
      if (result !== undefined) disposeOwned(result, disposeResult)
      const message = String(error)
      publish({
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        error: { code: controller.signal.aborted ? 'CANCELLED' : 'JOB_FAILED', message },
      })
      throw error
    } finally {
      external?.removeEventListener('abort', relay)
    }
  })
  return {
    promise,
    cancel: (reason?: unknown) => controller.abort(reason),
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
