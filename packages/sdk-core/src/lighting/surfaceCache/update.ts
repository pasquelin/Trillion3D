import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { cardLimits } from './cardResolution.ts'
import { processRequests, type CaptureWork } from './captures.ts'
import type { Feedback } from './feedback.ts'
import { removeAllMeshCards, updateAtlasSize } from './placements.ts'
import { cullPlacements, maxCapturesPerFrame, planRequests, type CardView } from './requests.ts'
import type { SurfaceCache } from './state.ts'

/**
 * THE IMAGE'S UPDATE of the surface cache, on the CPU: the one call that serves a view
 * (`updateSurfaceCache`), and the two clocks the passes after it advance.
 *
 * In the order of the steps: the settings are taken; the atlas is made again if its size or its kind
 * (compressed or not) changed, and emptied if the sharing or the downsampling was switched; the
 * tables are consolidated; the placements are given mesh cards or lose them (`cullPlacements`); the
 * law is asked about every card, the feedback read, the requests cut at the budget (`planRequests`);
 * and the requests are served (`processRequests`). What comes out is what the GPU does: the pages to
 * capture or copy.
 */

/** The view an image is served for. */
export interface UpdateView extends CardView {
  /** The feedback of the rays an earlier image made, read back, when one has arrived. */
  readonly feedback?: Feedback
  /** Whether a placement's mesh can be drawn yet: its clusters are resident. True by default. */
  readonly ready?: (placement: number) => boolean
  /** Whether the atlas the pages go to keeps its albedo, normal and emission in blocks; false by default. */
  readonly compressed?: boolean
}

/** Joins the runs given back in the cache's tables. */
function consolidate(cache: SurfaceCache) {
  cache.cards.consolidate()
  cache.meshCards.consolidate()
  cache.pages.consolidate()
}

/**
 * Serves the image: updates the cards of the scene for `view` under `settings` and returns what the
 * GPU must capture. `work.reset` says the atlas was remade or emptied, and its textures start again.
 * The records the passes changed are listed in `cache.changes`, for the upload.
 */
export function updateSurfaceCache(
  cache: SurfaceCache,
  settings: SurfaceCacheSettings,
  view: UpdateView,
): CaptureWork {
  cache.settings = settings
  const switched =
    cache.allowCardSharing !== settings.surfaceCacheAllowCardSharing ||
    cache.allowDownsampleFromSelf !== settings.surfaceCacheAllowCardDownsampleFromSelf
  cache.allowCardSharing = settings.surfaceCacheAllowCardSharing
  cache.allowDownsampleFromSelf = settings.surfaceCacheAllowCardDownsampleFromSelf
  const remade = updateAtlasSize(cache, view.compressed ?? false)
  consolidate(cache)
  if (switched) removeAllMeshCards(cache)
  cache.stats.meshCardsToAdd = 0
  cache.stats.lockedCardsToUpdate = 0
  cache.stats.hiResPagesToAdd = 0
  const budget = maxCapturesPerFrame(settings)
  let work: CaptureWork = { pages: [], texels: 0, hasCardCopy: false, reset: false }
  if (budget > 0) {
    const limits = cardLimits(settings, view.orthographic, view.clipmapExtent)
    cullPlacements(cache, view, limits)
    const requests = planRequests(cache, view, limits, view.feedback)
    work = processRequests(cache, requests, budget, view.ready)
  }
  work.reset = remade || switched
  return work
}

/** Moves the update clock on by an image — the clock of captures, and of the light's updates —: the
 *  lighting pass of the image calls it, once. */
export function advanceFrame(cache: SurfaceCache) {
  cache.frame = (cache.frame + 1) >>> 0 || 1
}

/** Moves the feedback clock on by an image: the clock of the pages' last reads, advanced when the image
 *  submitted its feedback. */
export function advanceFeedbackFrame(cache: SurfaceCache) {
  cache.feedbackFrame++
}
