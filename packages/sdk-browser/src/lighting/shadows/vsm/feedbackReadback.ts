/** THE GPU → CPU PATH OF THE SHADOW MAPS' STATUS FEEDBACK (`cacheManager.ts`, `readPoolFeedback`). */
import { createReadbackRing, type ReadbackRing } from '../../../gpu/core/readbackRing.ts'
import {
  FEEDBACK_MESSAGE_BYTES,
  VSM_COUNTERS,
  VSM_FEEDBACK_POOL,
  VSM_OVERFLOW_PAGE_POOL,
} from './constants.ts'
import type { VsmCacheManager } from './cacheManager.ts'
import type { VsmOverflowLog } from './overflowLog.ts'

/** Bytes of one readback: the 3-word message, then the overflow flags word of the frame. */
const READBACK_BYTES = FEEDBACK_MESSAGE_BYTES + 4
/** The words of the message: the pressure bias is the last, the flags word follows it. */
const PRESSURE_WORD = FEEDBACK_MESSAGE_BYTES / 4 - 1
const FLAGS_WORD = FEEDBACK_MESSAGE_BYTES / 4

/** Bytes the readback holds at most: `maxInFlight` copies of the message and the flags word. */
export const vsmFeedbackReadbackBytes = (maxInFlight = 3) => maxInFlight * READBACK_BYTES

/**
 * The GPU → CPU path of the status feedback message (the status feedback kernel): copies the 3-word
 * message of the `feedback` buffer ([message id, free pages, pressure bias bits]) and the overflow flags
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
          cache.readPoolFeedback(freePages, new Float32Array(mapped, PRESSURE_WORD * 4, 1)[0])
          // The pool is short of the pages asked when its free count goes negative.
          pagesShort = Math.max(0, -freePages)
          if (pagesShort === 0) overflow.poolServed()
        }
        overflow.note(
          words[FLAGS_WORD] | (pagesShort > 0 ? VSM_OVERFLOW_PAGE_POOL : 0),
          now,
          pagesShort,
        )
      },
    )
  }

  /** Records the copy of the `feedback` message and the flags word of `stats`; returns false when
   *  every staging buffer is still in flight (skipped). */
  encode(encoder: GPUCommandEncoder, feedback: GPUBuffer, stats: GPUBuffer) {
    const staging = this.ring.take()
    if (!staging) return false
    encoder.copyBufferToBuffer(feedback, 0, staging, 0, FEEDBACK_MESSAGE_BYTES)
    encoder.copyBufferToBuffer(stats, VSM_COUNTERS * 4, staging, FEEDBACK_MESSAGE_BYTES, 4)
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
