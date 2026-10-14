import type { WebgpuTileAtlas } from './atlasTypes.ts'
import type { WebgpuTileFeedback } from './feedback.ts'
import { createWebgpuTileReduce } from './reduce.ts'
import { createTileEvictions } from './evictSort.ts'

/**
 * What an image's feedback leaves with: the target where its pixels posted their requests — when a
 * pass wrote it — reduced to counters for the phase, the place each asked tile's entry names
 * stamped at the clock (`stampWgsl.ts`), the lane pools short of free places ranked on those
 * stamps (`evictSort.ts`), and the list and the queues copied to one readback. The clock advances
 * one an image: an arrival flushed before it is used at it (`slotUse.ts`).
 */
export function createTilePublish(
  device: GPUDevice,
  feedback: WebgpuTileFeedback,
  atlases: readonly WebgpuTileAtlas[],
) {
  const reduce = createWebgpuTileReduce(device)
  const evictions = createTileEvictions(device)
  const stamp = { clock: 1, atlases }
  return {
    /** The clock the next image stamps at. */
    get clock() {
      return stamp.clock
    },
    publish(
      encoder: GPUCommandEncoder,
      target: GPUTextureView | undefined,
      size: [number, number],
      every: boolean,
    ) {
      if (target) reduce.encode(encoder, target, feedback, size, feedback.phaseWord(every), stamp)
      // A queue rides the feedback's readback: none is cut when no buffer is free to carry it.
      const cut = feedback.available()
        ? evictions.encode(encoder, atlases, stamp.clock, target !== undefined)
        : undefined
      feedback.encode(encoder, cut)
      stamp.clock++
    },
    destroy() {
      reduce.destroy()
      evictions.destroy()
    },
  }
}
