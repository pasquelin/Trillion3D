/**
 * THE DISTANT LIGHTS: a local light whose shadow map fits in one page — the map's finest mip
 * needed by the view is the last (`vsmLocalMipLevel`) — takes one page, the last mip's, whatever
 * its size, always marked. A distant light is drawn once and then kept, whatever moves: the
 * invalidations of the casters leave it alone (`VsmLightCache.mayHoldCachedPages`), and it is drawn
 * again only on its turn in a schedule, `shadowMaxDistantUpdatePerFrame` lights a frame, the ones
 * left longest first — or at once where its own key changes: it moved, was turned, was resized, or
 * stopped being distant.
 */
import { VSM_MIPS } from './constants.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import type { VsmLightCache } from './lightCache.ts'

/** Whether a light whose view needs the mip `finestMip` at the finest is distant under `mode`
 *  (`shadowDistantLightMode`): 0 none are, 1 the lights of the last mip alone, 2 all of them. */
export const vsmDistantOf = (mode: number, finestMip: number) =>
  mode === 2 || (mode === 1 && finestMip === VSM_MIPS - 1)

// The schedule's picks and their ages, a handful at most, kept across frames.
const picked: VsmLightCache[] = []
const ages: number[] = []

/**
 * The frame's distant updates, before the lights are set up: of the fully cached distant lights
 * (`VsmLightCache.isFullyCached`), the `maxPerFrame` left longest unscheduled are marked scheduled
 * at the scene frame `sceneFrame` (`VsmLightCache.markScheduled`), and `addVsmLocalLightShadow` draws
 * them again. A negative `maxPerFrame` picks them all, 0 none — then no distant light is drawn again
 * until its key changes —; nothing is picked while the cache is off. The schedule turns once a scene
 * frame, as the reference's does for the scene render: the views set up in it, or a view set up
 * twice, pick none after the first (the distant lights' maps are shared by every view, and the first
 * view drew the ones picked).
 */
export function scheduleDistantUpdates(
  cache: VsmCacheManager,
  maxPerFrame: number,
  sceneFrame: number,
) {
  const most = maxPerFrame < 0 ? Infinity : maxPerFrame
  if (most === 0 || !cache.cacheEnabled || cache.distantRotatedAt === sceneFrame) return
  cache.distantRotatedAt = sceneFrame
  picked.length = ages.length = 0
  for (const entry of cache.entries.values()) {
    if (!entry.isFullyCached()) continue
    const age = sceneFrame - entry.scheduledFrame
    if (picked.length < most) {
      picked.push(entry)
      ages.push(age)
      continue
    }
    // Full: a light left longer than the least of the picks takes its place.
    const least = ages.indexOf(Math.min(...ages))
    if (ages[least] < age) {
      picked[least] = entry
      ages[least] = age
    }
  }
  for (const entry of picked) entry.markScheduled(sceneFrame)
}
