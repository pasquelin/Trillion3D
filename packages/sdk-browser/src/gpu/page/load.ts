import type { GpuPageContext, ResidentPage } from './types.ts'
import { commitGpuPage, evictResident } from './commit.ts'
import { refusedStatus } from '../../cluster/checked.ts'

/** A load that failed leaves the next ones their turn. */
const ignore = () => {}

/** `tier` pins the page inside the queued operation: no resize queued behind the load runs between
 *  its arrival and its pin, so a held page is never ranked as an unpinned one. `priority` is its
 *  read's. A page absent at the request is read at once — reads overlap, uploads stay in order —,
 *  its bytes left unused when the page is resident by its turn; a page resident at the request is
 *  read only if it left by its turn. A failure fails the load, and its source says when the page
 *  is asked again (`streaming/failures.ts`). */
export function createGpuPageLoader(context: GpuPageContext, pin: Pin) {
  const { resident, state, reader } = context
  const { emit, now } = reader
  return function load(
    key: string,
    signal?: AbortSignal,
    tier?: PagePinTier,
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
    const job: Load = {
      key,
      signal,
      tier,
      priority,
      abortListener,
      requestStarted,
      fetched: resident.has(key) ? undefined : readOf(context, key, signal, priority),
    }
    state.loading++
    const operation = state.pending.then(() => runLoad(context, pin, job))
    state.pending = operation.catch(ignore)
    return operation
  }
}

/** `key`'s read, cancelled by `signal` or by the pool's dispose. */
const readOf = (
  { abort, reader }: GpuPageContext,
  key: string,
  signal: AbortSignal | undefined,
  priority: number | undefined,
) => reader.read(key, signal ? AbortSignal.any([signal, abort.signal]) : abort.signal, priority)

/** How a loaded page is pinned: `'held'` ahead of ordinary pins on a resize, else `'pinned'`. */
export type PagePinTier = 'held' | 'pinned'
type Pin = (key: string, tier: PagePinTier) => void
/** One load as its queued operation reads it. */
type Load = {
  key: string
  signal: AbortSignal | undefined
  tier: PagePinTier | undefined
  priority: number | undefined
  abortListener: (() => void) | undefined
  requestStarted: number
  /** Its read, started with the request when the page was absent. */
  fetched: Promise<Uint8Array> | undefined
}

/** The load's turn in the queue: the resident page, or the bytes read, checked and committed. */
async function runLoad(context: GpuPageContext, pin: Pin, job: Load): Promise<ResidentPage> {
  const { resident, state, check, pins } = context
  const { report, emit, now } = context.reader
  const { key, tier, signal, abortListener } = job
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
      if (tier) pin(key, tier)
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
    const page = commitGpuPage(context, key, bytes, placeOf(context, key), job.requestStarted)
    if (tier) pin(key, tier)
    return page
  } catch (error) {
    emit?.('gpu-page-error', 'GPU load failed', () => ({
      version: 1,
      key,
      status: refusedStatus(error),
      aborted: signal?.aborted === true || context.abort.signal.aborted,
      error: String(error),
      resident: resident.size,
      pinned: pins.size,
    }))
    throw error
  } finally {
    if (abortListener) signal!.removeEventListener('abort', abortListener)
    state.loading--
  }
}

/** The page already resident, made the most recent; undefined when absent. */
function residentHit({ resident, eviction, reader }: GpuPageContext, key: string) {
  const existing = resident.get(key)
  if (!existing) return undefined
  eviction.touched(key)
  reader.emit?.('gpu-page-cache-hit', 'GPU page already resident', () => ({
    version: 1,
    key,
    slot: existing.slot,
    generation: existing.generation,
    source: 'resident-cache',
  }))
  return existing
}

/** A page fills its own home at most, where the pool holds the whole catalogue: one past it would
 *  write over its neighbour. */
function checkRoom(context: GpuPageContext, key: string, bytes: Uint8Array) {
  const room = context.placement.room(key)
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

/** `key`'s place, its victim evicted; refused by name when every slot is pinned or the published
 *  order is spent. */
function placeOf(context: GpuPageContext, key: string) {
  const place = context.placement.slotFor(key)
  if (typeof place === 'string') {
    const { resident, slots, pins } = context
    context.reader.emit?.('gpu-page-admission-blocked', 'No evictable GPU slot', () => ({
      version: 1,
      key,
      reason: place,
      resident: resident.size,
      slots,
      pinned: pins.size,
    }))
    throw new Error('ALL_PAGES_PINNED')
  }
  if (place.victim) evictResident(context, place.victim, 'capacity')
  return place
}
