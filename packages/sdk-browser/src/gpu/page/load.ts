import type { GpuPageContext, ResidentPage } from './types.ts'
import { commitGpuPage, homeOf } from './commit.ts'
import { refusedStatus, retriableError } from '../../cluster/checked.ts'

/** `tier` pins the page inside the queued operation: no resize queued behind the load runs between
 *  its arrival and its pin, so a held page is never ranked as an unpinned one. `priority` is its read's. */
export function createGpuPageLoader(context: GpuPageContext, pin: Pin) {
  const { abort, resident, fetches, state, reader } = context
  const { report, emit, now, fetchBytes } = reader
  return function load(
    key: string,
    signal?: AbortSignal,
    tier?: PagePinTier,
    priority?: number,
  ): Promise<ResidentPage> {
    const combined = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal
    const abortListener =
      report && signal
        ? () =>
            emit?.('gpu-page-abort', 'GPU load cancelled', () => ({
              version: 1,
              key,
              reason: String(signal.reason ?? 'aborted'),
            }))
        : undefined
    if (abortListener) signal?.addEventListener('abort', abortListener, { once: true })
    const requestStarted = now()
    emit?.('gpu-page-request', 'GPU page request received', () => ({
      version: 1,
      key,
      resident: resident.has(key),
      loading: fetches.has(key),
    }))
    const fetched =
      !state.disposed && !resident.has(key) ? fetchBytes(key, combined, priority) : undefined
    const job: Load = {
      key,
      signal,
      tier,
      priority,
      combined,
      abortListener,
      requestStarted,
      fetched,
    }
    const operation = state.pending.then(() => runLoad(context, pin, job))
    state.pending = operation.catch(() => {})
    return operation
  }
}

/** How a loaded page is pinned: `'held'` ahead of ordinary pins on a resize, else `'pinned'`. */
export type PagePinTier = 'held' | 'pinned'
type Pin = (key: string, tier: PagePinTier) => void
/** One load as its queued operation reads it. */
type Load = {
  key: string
  signal: AbortSignal | undefined
  tier: PagePinTier | undefined
  priority: number | undefined
  combined: AbortSignal
  abortListener: (() => void) | undefined
  requestStarted: number
  fetched: Promise<Uint8Array> | undefined
}

/** The load's turn in the queue: the resident page, or the bytes read, checked and committed. */
async function runLoad(context: GpuPageContext, pin: Pin, job: Load): Promise<ResidentPage> {
  const { resident, fetches, check, pins } = context
  const { report, emit, now } = context.reader
  const { key, combined, tier, signal, abortListener } = job
  const queueStarted = now()
  try {
    check(combined)
    emit?.('gpu-page-queue-wait', 'GPU load CPU queue wait finished', () => ({
      version: 1,
      key,
      durationMs: report ? queueStarted - job.requestStarted : null,
    }))
    const existing = residentHit(context, key)
    if (existing) {
      if (tier) pin(key, tier)
      return existing
    }
    emit?.('gpu-page-cache-miss', 'Page absent from GPU residency', () => ({
      version: 1,
      key,
      source: 'page-source',
    }))
    const bytes = await readPageBytes(context, job)
    check(combined)
    checkRoom(context, key, bytes)
    const page = commitGpuPage(context, key, bytes, job.requestStarted)
    if (tier) pin(key, tier)
    return page
  } catch (error) {
    emit?.('gpu-page-error', 'GPU load failed', () => ({
      version: 1,
      key,
      status: refusedStatus(error),
      aborted: combined.aborted,
      error: String(error),
      resident: resident.size,
      pinned: pins.size,
    }))
    throw error
  } finally {
    if (abortListener) signal?.removeEventListener('abort', abortListener)
    fetches.delete(key)
  }
}

/** The page already resident, made the most recent; undefined when absent. */
function residentHit({ resident, reader }: GpuPageContext, key: string) {
  const existing = resident.get(key)
  if (!existing) return undefined
  resident.delete(key)
  resident.set(key, existing)
  reader.emit?.('gpu-page-cache-hit', 'GPU page already resident', () => ({
    version: 1,
    key,
    slot: existing.slot,
    generation: existing.generation,
    source: 'resident-cache',
  }))
  return existing
}

/** The page's bytes: the read started with the request, or one now, asked again once after a
 *  failure another request would not meet again. */
async function readPageBytes({ state, reader }: GpuPageContext, job: Load) {
  const { key, combined, priority } = job
  try {
    return await (job.fetched ?? reader.fetchBytes(key, combined, priority))
  } catch (err) {
    // A refusal another request would meet again (a 4xx) is not asked twice (`checked`).
    if (!combined.aborted && !state.disposed && retriableError(err)) {
      reader.emit?.('gpu-page-retry', 'New GPU read after failure', () => ({
        version: 1,
        key,
        attempt: 1,
        nextAttempt: 2,
        error: String(err),
      }))
      return await reader.readBytes(key, combined, 2, priority)
    }
    throw err
  }
}

/** A page fills its own home at most, where the pool holds the whole catalogue: one past it would
 *  write over its neighbour. */
function checkRoom(context: GpuPageContext, key: string, bytes: Uint8Array) {
  const room = homeOf(context, key)?.bytes ?? context.pageBytes
  if (bytes.byteLength <= room && bytes.byteLength !== 0) return
  const { emit } = context.reader
  emit?.('gpu-page-corruption', 'Unexpected GPU page size', () => ({
    version: 1,
    key,
    reason: 'page-size-mismatch',
    expectedBytes: room,
    actualBytes: bytes.byteLength,
  }))
  emit?.('gpu-page-admission-blocked', 'Page refused by a GPU slot capacity', () => ({
    version: 1,
    key,
    reason: 'page-size-mismatch',
    expectedBytes: room,
    actualBytes: bytes.byteLength,
  }))
  throw new Error('PAGE_SIZE_MISMATCH')
}
