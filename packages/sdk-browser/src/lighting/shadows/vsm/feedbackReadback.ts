/** THE GPU → CPU PATH OF THE SHADOW MAPS' STATUS FEEDBACK (`cacheManager.ts`, `readPoolFeedback`). */
import { createReadbackRing, type ReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { VSM_FEEDBACK_POOL } from './constants.ts'
import type { VsmCacheManager } from './cacheManager.ts'

/** Bytes the readback holds at most: `maxInFlight` copies of the 4-word message. */
export const vsmFeedbackReadbackBytes = (maxInFlight = 3) => maxInFlight * 16

/**
 * The GPU → CPU path of the status feedback message (the status feedback kernel): copies the 4-word
 * `feedback` buffer ([message id, free pages, pressure bias bits, scene frame]) into a mappable
 * buffer and, when it maps, feeds `VsmCacheManager.readPoolFeedback`. A few frames in flight,
 * never stalls.
 */
export class VsmFeedbackReadback {
  private readonly ring: ReadbackRing

  constructor(device: GPUDevice, cache: VsmCacheManager, maxInFlight = 3) {
    this.ring = createReadbackRing(
      device,
      { label: 'vsm.feedbackReadback', bytes: 16, count: maxInFlight },
      (mapped) => {
        const words = new Uint32Array(mapped)
        if (words[0] === (VSM_FEEDBACK_POOL as number))
          cache.readPoolFeedback(words[1] | 0, new Float32Array(mapped, 8, 1)[0])
      },
    )
  }

  /** Records the copy; returns false when every staging buffer is still in flight (skipped). */
  encode(encoder: GPUCommandEncoder, feedback: GPUBuffer) {
    const staging = this.ring.take()
    if (!staging) return false
    encoder.copyBufferToBuffer(feedback, 0, staging, 0, 16)
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
