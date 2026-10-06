import type { RenderBackend } from '../backend/types.ts'
import type { createPageStreamer } from './pageStreamer.ts'

/** Pin the pages of either page backend through its request-rank difference. */
export function retainVisiblePages(
  backend: RenderBackend,
  streamer: ReturnType<typeof createPageStreamer>,
) {
  const ranks = backend.retainedRanks?.()
  if (ranks) streamer.retainRanks(ranks)
}
