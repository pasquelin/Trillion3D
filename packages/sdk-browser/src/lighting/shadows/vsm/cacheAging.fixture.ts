import type { VsmCacheManager } from './cacheManager.ts'
import type { VsmLightCache } from './lightCache.ts'
import type { VsmMapIds } from './mapIds.ts'

/** One frame's claim of the unseen lights' ids, as the frame does it: reset, the seen entries claimed, the unseen ones, sealed and committed. */
export function claimFrame(cache: VsmCacheManager, ids: VsmMapIds, seen: VsmLightCache[] = []) {
  ids.reset()
  for (const entry of seen) ids.claim(entry, entry.view === undefined ? 'light' : 'sun')
  cache.claimUnseenLights(ids)
  ids.seal()
  cache.commitIds(ids)
}
