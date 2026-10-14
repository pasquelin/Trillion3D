import type { GpuPageContext, ResidentPage } from './types.ts'
import { behind } from '../core/behind.ts'
import { commitGpuPage } from './commit.ts'
import { checkRoom, placeOf, placesFor, refusal } from './loadPlace.ts'
import { refusedStatus } from '../../cluster/checked.ts'
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts'

/** `pinned` pins the page inside the queued operation: no resize queued behind the load runs between
 *  its arrival and its pin, so a pinned page is never ranked as an unpinned one. `priority` is its
 *  read's. A page absent at the request is read at once — reads overlap, uploads stay in order —,
 *  its bytes left unused when the page is resident by its turn; a page resident at the request is
 *  read only if it left by its turn. A failure fails the load, and its source says when the page
 *  is asked again (`streaming/failures.ts`). A page absent when the pool has no place to give —
 *  free, or that the GPU's order gives up — is refused at once, read for nothing never: the refusal is noted (`takeRefused`), so the GPU is asked a new order. */
export function createGpuPageLoader(context: GpuPageContext, pin: Pin) {
  const { resident, state, reader } = context
  const { emit, now } = reader
  return function load(
    key: string,
    signal?: AbortSignal,
    pinned?: boolean,
    priority?: number,
  ): Promise<ResidentPage> {
    const abortListener =
      emit && signal
        ? () =>
            emit('gpu-page-abort', 'GPU load cancelled', () => ({
              version: 1,
              key,
              reason: String(signal.reason ?? 'aborted'),
            }))
        : undefined
    if (abortListener) signal!.addEventListener('abort', abortListener, { once: true })
    const requestStarted = now()
    emit?.('gpu-page-request', 'GPU page request received', () => ({
      version: 1,
      key,
      resident: resident.has(key),
      loading: state.loading,
    }))
    const prefetch = priority === PRIORITY_PREFETCH
    if (!resident.has(key) && placesFor(context, prefetch) <= 0) {
      if (abortListener) signal!.removeEventListener('abort', abortListener)
      return Promise.reject(refusal(context, key, 'eviction-queue-spent'))
    }
    const job: Load = {
      key,
      signal,
      pinned,
      priority,
      abortListener,
      requestStarted,
      fetched: resident.has(key) ? undefined : readOf(context, key, signal, priority),
    }
    state.loading++
    return behind(state, () => runLoad(context, pin, job))
  }
}

/** `signal` joined with the pool's dispose, made once for a signal that many loads share. */
const joined = new WeakMap<AbortSignal, WeakMap<AbortSignal, AbortSignal>>()
function cancelledBy(signal: AbortSignal, dispose: AbortSignal) {
  let own = joined.get(signal)
  if (!own) joined.set(signal, (own = new WeakMap()))
  let both = own.get(dispose)
  if (!both) own.set(dispose, (both = AbortSignal.any([signal, dispose])))
  return both
}

/** `key`'s read, cancelled by `signal` or by the pool's dispose. */
const readOf = (
  { abort, reader }: GpuPageContext,
  key: string,
  signal: AbortSignal | undefined,
  priority: number | undefined,
) => reader.read(key, signal ? cancelledBy(signal, abort.signal) : abort.signal, priority)

type Pin = (key: string) => void
/** One load as its queued operation reads it. */
type Load = {
  key: string
  signal: AbortSignal | undefined
  pinned: boolean | undefined
  priority: number | undefined
  abortListener: (() => void) | undefined
  requestStarted: number
  /** Its read, started with the request when the page was absent. */
  fetched: Promise<Uint8Array> | undefined
}

/** The load's turn in the queue: the resident page, or the bytes read, checked and committed. */
async function runLoad(context: GpuPageContext, pin: Pin, job: Load): Promise<ResidentPage> {
  const { resident, state, check, eviction } = context
  const { report, emit, now } = context.reader
  const { key, pinned, signal, abortListener } = job
  const queueStarted = now()
  try {
    check(signal)
    emit?.('gpu-page-queue-wait', 'GPU load CPU queue wait finished', () => ({
      version: 1,
      key,
      durationMs: report ? queueStarted - job.requestStarted : null,
    }))
    const existing = residentHit(context, key)
    if (existing) {
      if (pinned) pin(key)
      return existing
    }
    emit?.('gpu-page-cache-miss', 'Page absent from GPU residency', () => ({
      version: 1,
      key,
      source: 'page-source',
    }))
    const bytes = await (job.fetched ?? readOf(context, key, signal, job.priority))
    check(signal)
    checkRoom(context, key, bytes)
    const page = commitGpuPage(
      context,
      key,
      bytes,
      placeOf(context, key, bytes.byteLength, job.priority === PRIORITY_PREFETCH),
      job.requestStarted,
    )
    if (pinned) pin(key)
    return page
  } catch (error) {
    emit?.('gpu-page-error', 'GPU load failed', () => ({
      version: 1,
      key,
      status: refusedStatus(error),
      aborted: signal?.aborted === true || context.abort.signal.aborted,
      error: String(error),
      resident: resident.size,
      pinned: eviction.pinnedCount,
    }))
    throw error
  } finally {
    if (abortListener) signal!.removeEventListener('abort', abortListener)
    state.loading--
  }
}

/** The page already resident; undefined when absent. */
function residentHit({ resident, reader }: GpuPageContext, key: string) {
  const existing = resident.get(key)
  if (!existing) return undefined
  reader.emit?.('gpu-page-cache-hit', 'GPU page already resident', () => ({
    version: 1,
    key,
    slot: existing.slot,
    generation: existing.generation,
    source: 'resident-cache',
  }))
  return existing
}
