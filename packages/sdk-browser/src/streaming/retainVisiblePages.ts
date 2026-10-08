import type { Engine } from '../engine/types.ts'
import type { createPageStreamer } from './pageStreamer.ts'

/** Pins the pages the engine's view reads through its request-rank difference. */
export function retainVisiblePages(
  backend: Engine,
  streamer: ReturnType<typeof createPageStreamer>,
) {
  streamer.retainRanks(backend.retainedRanks())
}
