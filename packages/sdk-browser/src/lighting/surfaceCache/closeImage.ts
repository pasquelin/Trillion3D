import type { SurfaceCacheFrameMetrics } from '../../../../sdk-core/src/contracts/surfaceCacheMetrics.ts'
import { updateFrameFrozen } from '../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { advanceFrame } from '../../../../sdk-core/src/lighting/surfaceCache/update.ts'
import type { SurfaceCacheFrameState } from './frame.ts'

/** The account of the last image. */
export function metricsOf(
  state: SurfaceCacheFrameState,
  account: Pick<SurfaceCacheFrameMetrics, 'captured' | 'copied' | 'refreshed' | 'waiting'>,
  heldBack = 0,
): SurfaceCacheFrameMetrics {
  const { cache, atlases, shading, tables } = state
  const pagesTotal = cache.allocator.pagesX * cache.allocator.pagesY
  return {
    atlasSide: atlases?.side ?? 0,
    captureSide: atlases?.captureSide ?? 0,
    bytes: (atlases?.bytes ?? 0) + (shading?.bytes ?? 0) + tables.bytes,
    placements: state.placements.count,
    meshCards: cache.meshCards.length,
    cards: cache.cards.length,
    pagesUsed: pagesTotal - cache.allocator.freePages,
    pagesTotal,
    ...account,
    // The pages asked again, and the refusals of an object held back for its textures (`texturesPending`).
    waiting: account.waiting + heldBack,
    meshCardsToAdd: cache.stats.meshCardsToAdd,
    lockedCardsToUpdate: cache.stats.lockedCardsToUpdate,
    hiResPagesToAdd: cache.stats.hiResPagesToAdd,
    desiredTexels: cache.stats.desiredTexels,
    raster: !state.raster.failure,
    why: state.why,
    compressed: atlases?.compressed ?? false,
    compressionWhy: state.compressionWhy,
  }
}

/** What closes an image: why the capture or the raster could not be made, if they could not; whether
 *  the cache still waits for work; the clock; the image's metrics from its `account`. */
export function closeImage(
  state: SurfaceCacheFrameState,
  account: Parameters<typeof metricsOf>[1],
  heldBack: number,
) {
  const { cache, raster } = state
  if (state.shading?.failure)
    state.why = `the capture's shading could not be made: ${String(state.shading.failure)}`
  else if (raster.failure)
    state.why = `the cards' raster could not be made: ${String(raster.failure)}`
  // The requests the image left; the refresh of the pages captured longest ago goes on whatever the view
  // does, and keeps nothing unheld: it leaves the light of its pages (`CapturePage.refresh`).
  const { meshCardsToAdd, lockedCardsToUpdate, hiResPagesToAdd } = cache.stats
  // Work left: cards to add or update, pages asked again, or an object held back for its textures — which land between two images and are
  // captured by the next, so the frame must not be held before it. The GPU's update of the scene (`surfaceCacheGpuDrivenUpdate`) answers a few images late: the frame is not held until its lists are quiet.
  state.busy =
    meshCardsToAdd + lockedCardsToUpdate + hiResPagesToAdd > 0 ||
    account.waiting + heldBack > 0 ||
    !!state.gpuDriven?.settling
  // A frozen cache or update frame keeps the clock where it is (`surfaceCacheFreeze`, `surfaceCacheFreezeUpdateFrame`).
  if (!updateFrameFrozen(state.settings)) advanceFrame(cache)
  state.updated = true
  state.metrics = metricsOf(state, account, heldBack)
}
