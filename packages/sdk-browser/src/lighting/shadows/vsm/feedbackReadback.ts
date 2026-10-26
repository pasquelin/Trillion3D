/** THE GPU → CPU PATH OF THE SHADOW MAPS' STATUS FEEDBACK (`cacheManager.ts`, `readPoolFeedback`). */
import { createReadbackRing, type ReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { VSM_FEEDBACK_POOL, VSM_OVERFLOW_FLAGS, VSM_OVERFLOW_PAGE_POOL } from './constants.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import type { VsmOverflowLog } from './overflowLog.ts'

/** Bytes of one readback: the 4-word message, then the overflow flags word of the frame. */
const READBACK_BYTES = 20

/** Bytes the readback holds at most: `maxInFlight` copies of the message and the flags word. */
export const vsmFeedbackReadbackBytes = (maxInFlight = 3) => maxInFlight * READBACK_BYTES

/**
 * The GPU → CPU path of the status feedback message (the status feedback kernel): copies the 4-word
 * `feedback` buffer ([message id, free pages, pressure bias bits, scene frame]) and the overflow flags
 * word of the `stats` buffer into a mappable buffer and, when it maps, feeds
 * `VsmCacheManager.readPoolFeedback` and the overflow log. The flags ride the message's copy, so they
 * are read back whatever the counters say, with no ring of their own. A few frames in flight, never
 * stalls.
 */
export class VsmFeedbackReadback {
  private readonly ring: ReadbackRing

  constructor(
    device: GPUDevice,
    cache: VsmCacheManager,
    overflow: VsmOverflowLog,
    maxInFlight = 3,
  ) {
    this.ring = createReadbackRing(
      device,
      { label: 'vsm.feedbackReadback', bytes: READBACK_BYTES, count: maxInFlight },
      (mapped) => {
        const words = new Uint32Array(mapped),
          now = performance.now()
        let pagesShort = 0
        if (words[0] === (VSM_FEEDBACK_POOL as number)) {
          const freePages = words[1] | 0
          cache.readPoolFeedback(freePages, new Float32Array(mapped, 8, 1)[0])
          // The pool is short of the pages asked when its free count goes negative.
          pagesShort = Math.max(0, -freePages)
          if (pagesShort === 0) overflow.poolServed()
        }
        overflow.note(words[4] | (pagesShort > 0 ? VSM_OVERFLOW_PAGE_POOL : 0), now, pagesShort)
      },
    )
  }

  /** Records the copy of the `feedback` message and the flags word of `stats`; returns false when
   *  every staging buffer is still in flight (skipped). */
  encode(encoder: GPUCommandEncoder, feedback: GPUBuffer, stats: GPUBuffer) {
    const staging = this.ring.take()
    if (!staging) return false
    encoder.copyBufferToBuffer(feedback, 0, staging, 0, 16)
    encoder.copyBufferToBuffer(stats, VSM_OVERFLOW_FLAGS * 4, staging, 16, 4)
    return true
  }

  /** Call after `queue.submit` of the encoder given to `encode`. */
  afterSubmit() {
    this.ring.submitted()
  }

  destroy() {
    this.ring.destroy()
  }
}
