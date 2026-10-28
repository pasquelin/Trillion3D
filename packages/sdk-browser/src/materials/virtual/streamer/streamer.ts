import { createWebgpuTileFeedback } from '../feedback.ts'
import { createTilePublish } from '../publish.ts'
import { createTileCounters } from '../counters.ts'
import { createTileRequests } from '../requests.ts'
import { createTileGrowth } from '../growth.ts'
import { textureJournals } from '../../../../../sdk-core/src/texture/writes.ts'
import { createTilePump } from '../pump.ts'
import { createResidencyBias } from '../residencyBias.ts'
import {
  createHeldSources,
  createSamplingFollow,
  createWarmth,
  openStreamerAtlases,
  type TileStreamerOptions,
} from './streamerParts.ts'
/**
 * Tile streamer: what the image asked becomes resident, under a per-image budget of 32 tiles and
 * of bytes AND milliseconds, most urgent tile first. Image-feedback counters name the tiles; the streamer
 * skips those that reside, reads the cooked levels of the others and copies them as soon as
 * their bytes are there, taking the places the GPU's queue gives up when the pool is full: the
 * places no pixel read of late (`../publish.ts`).
 *
 * Both budgets are fixed by the host, never read off the machine. The millisecond one is what
 * keeps a cold traversal from stalling the frame: a pass stops copying once it has spent it, the
 * remainder is deferred to the next pass — shown meanwhile by its finest resident ancestor level —
 * and the worst pass of the session is published (`textureUploadPeakMs`), since a stutter is a
 * peak, never a median.
 *
 * Nothing waits here: a tile whose level is still being read comes back on the next feedback. Only
 * the barrier (`flush`) asks for convergence: every pixel speaks, the budgets are lifted, the loop
 * replays until no requested tile is missing.
 */
export function createWebgpuTileStreamer(options: TileStreamerOptions) {
  const { device, encoding } = options
  const { color, data } = openStreamerAtlases(device, options, () => published.clock)
  const feedback = createWebgpuTileFeedback(device, color.pages.entries + data.pages.entries)
  const counters = createTileCounters()
  const sources = createHeldSources(device, options, counters)
  const requests = createTileRequests({ feedback, color, data, counters })
  const atlases: [typeof color, typeof data] = [color, data]
  const published = createTilePublish(device, feedback, atlases)
  const follow = createSamplingFollow(
    device,
    atlases,
    sources,
    options.onColorChanged,
    options.filtering,
  )
  return {
    color,
    data,
    feedback,
    counters,
    sources,
    prepare: follow.prepare,
    pump: createTilePump({
      ...options,
      color,
      sources,
      requests,
      counters,
      residency: createResidencyBias(atlases),
      flushAll: follow.flushAll,
    }),
    followSampling: follow.followSampling,
    warm: createWarmth(color, data, requests),
    /** An image's feedback leaves with it (`../publish.ts`). */
    publishRequests: published.publish,
    ...createTileGrowth(options, {
      color,
      data,
      feedback,
      sources,
      flushAll: follow.flushAll,
      followHeaders: follow.followHeaders,
      resetRequests: requests.reset,
    }),
    metrics: () => counters.metrics(atlases, sources, encoding.name),
    /** True while a level is read or a working texture built: a missing tile can still come. */
    get reading() {
      return sources.reading
    },
    /** Held when feedback, level reads and the working textures asked have all landed. */
    settled: () => Promise.all([feedback.settled(), sources.settled()]).then(() => undefined),
    destroy() {
      textureJournals.close(follow.journal)
      sources.destroy()
      published.destroy()
      feedback.destroy()
      color.destroy()
      data.destroy()
    },
  }
}
export type WebgpuTileStreamer = ReturnType<typeof createWebgpuTileStreamer>
