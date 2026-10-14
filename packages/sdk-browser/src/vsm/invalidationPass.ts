/**
 * Cache invalidation (step 7): what a frame set holds for it. One stale reads every change — the
 * rows' shadow changes the GPU appended and the CPU's boxes of what no row says — against the
 * previous frame's maps, before `encodeVsmPageCarry` (`castInvalidation.ts`), atomically OR-ing
 * STALE_STATIC_MARK / STALE_DYNAMIC_MARK into `res.prev.pageRequests`, which the page address
 * update folds into the page metadata.
 *
 * Light moves / cache key changes are not here: the cache entry is invalidated on the CPU
 * (`VsmLightCache.updateCommon`), so the map is set up uncached
 * (VSM_MAP_UNCACHED) and its next map drops VSM_NEXT_KEEPS_PAGES; the collector skips such entries.
 */
import type { VsmResources } from './resources.ts'
import { releaseCastInvalidation, type VsmCastState } from './castStale.ts'

/** What the invalidation of a set holds (`VsmResources.invalidation`). */
export interface VsmInvalidationState {
  /** The stale of the shadow changes (`castStale.ts`). */
  casts?: VsmCastState
}

/** What the invalidations of `res` hold, made at their first use. */
export const invalidationOf = (res: VsmResources) => (res.invalidation ??= {})

/** Frees what `res`'s invalidation holds, with the set (`destroyEngineVsm`). */
export function releaseVsmInvalidation(res: VsmResources) {
  if (res.invalidation) releaseCastInvalidation(res.invalidation)
  res.invalidation = undefined
}
