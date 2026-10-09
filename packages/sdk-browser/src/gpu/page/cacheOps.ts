import { evictResident } from './commit.ts'
import { heldHomes } from './homes.ts'
import { resizeGpuPages } from './resize.ts'
import type { GpuPageContext } from './types.ts'

/** Changes the pool size behind the loads in flight (`createGpuPageCache`, `resize`). */
export function resizeBehind(context: GpuPageContext, slots: number) {
  const { state } = context
  const operation = state.pending.then(() => {
    context.check()
    return resizeGpuPages(context, slots)
  })
  state.pending = operation.catch(() => {})
  return operation
}

/** Moves the pending residency changes into the caller's arrays, then empties the log. */
export function drainResidencyChanges(context: GpuPageContext, keys: string[], slots: number[]) {
  const { changeKeys, changeSlots } = context
  for (let i = 0; i < changeKeys.length; i++) {
    keys.push(changeKeys[i])
    slots.push(changeSlots[i])
  }
  changeKeys.length = 0
  changeSlots.length = 0
}

/** Evicts `key` unless it is absent or pinned; true when it left. */
export function unloadPage(context: GpuPageContext, key: string) {
  const { emit } = context.reader
  const page = context.resident.get(key)
  if (!page) {
    emit?.('gpu-page-unload-refused', 'GPU unload refused', () => ({
      version: 1,
      key,
      reason: 'not-resident',
    }))
    return false
  }
  if (context.pins.has(key)) {
    emit?.('gpu-page-unload-refused', 'GPU unload refused', () => ({
      version: 1,
      key,
      slot: page.slot,
      generation: page.generation,
      reason: 'pinned',
    }))
    return false
  }
  evictResident(context, page, 'explicit-unload')
  context.free.push(page.slot)
  return true
}

/** The pool's sizes and counters. */
export function pageCacheStats(context: GpuPageContext) {
  const { state, pageBytes, slots } = context
  return {
    allocatedBytes: heldHomes(context.homes, slots)?.bytes ?? pageBytes * slots,
    slots,
    residentPages: context.resident.size,
    /** Loads in flight: each takes a slot when it lands. */
    loading: context.fetches.size,
    bytesRead: state.bytesRead,
    uploadedBytes: state.uploadedBytes,
    evictions: state.evictions,
    physicalVramBytes: null,
  }
}

/** Releases the pool: its pages forgotten at once, its buffer destroyed once the queue is done. */
export function disposePageCache(context: GpuPageContext) {
  const { state, resident, device } = context
  if (state.disposed) return state.pending.then(() => {})
  context.reader.emit?.('gpu-page-dispose', 'GPU cache released', () => ({
    version: 1,
    resident: resident.size,
    loading: context.fetches.size,
    evictions: state.evictions,
  }))
  state.disposed = true
  context.abort.abort()
  resident.clear()
  context.pins.clear()
  context.held.clear()
  state.pending = state.pending
    .catch(() => {})
    .then(async () => {
      try {
        await device.queue.onSubmittedWorkDone()
      } catch {
        /* Queue may already be lost. */
      }
      context.buffer.destroy()
    })
  return state.pending
}
