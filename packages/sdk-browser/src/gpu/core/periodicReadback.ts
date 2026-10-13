import { createReadbackRing } from './readbackRing.ts'

/**
 * Frames between two samples. A sample is a diagnostic: frames in between copy nothing and map
 * nothing, and none ever waits for a sample to return.
 */
const READ_EVERY_IMAGES = 15

/**
 * Periodic sample of counters the GPU wrote, one frame in fifteen. The caller samples a frame,
 * encodes the copy of what it wrote, then signals submission: mapping is requested only after,
 * otherwise that submission would carry a mapped buffer. One sample is in flight at a time, and
 * `read` receives the mapped range, to be read in place before it is unmapped.
 *
 * A device loss or a dispose cancels the mapping: counters keep their last frame, nothing is
 * inferred. The sample buffer, `bytes` long under `label`, is made by the first copy, or at once
 * with `eager`.
 */
export function createGpuPeriodicReadback(
  device: Pick<GPUDevice, 'createBuffer'>,
  options: { label: string; bytes: number; eager?: boolean },
  read: (mapped: ArrayBuffer) => void,
) {
  let bytes = 0,
    ready = false,
    copyEncoded = false,
    disposed = false,
    lastSampledFrame = -READ_EVERY_IMAGES
  const ring = createReadbackRing(device, { ...options, count: 1 }, (mapped) => {
    read(mapped)
    ready = true
  })

  return {
    /** True once a sample has returned, until dispose. */
    get ready() {
      return ready
    },
    /** True when the interval has elapsed and no sample is still in flight. */
    due(frame: number) {
      return !copyEncoded && ring.available() && frame - lastSampledFrame >= READ_EVERY_IMAGES
    },
    /** Notes the sampled frame: the interval runs from it. */
    sampled(frame: number) {
      lastSampledFrame = frame
    },
    /** True while frame `frame`'s sample is encoded and not yet submitted: its copies join it. */
    open(frame: number) {
      return copyEncoded && frame === lastSampledFrame
    },
    /** Encodes the copy of `size` bytes from `source`, to be mapped once the frame is submitted,
     *  and whether it did. The copies of one sampled frame follow each other in the sample. */
    copy(encoder: GPUCommandEncoder, source: GPUBuffer, offset: number, size: number) {
      const target = ring.take()
      if (!target) return false
      const at = copyEncoded ? bytes : 0
      encoder.copyBufferToBuffer(source, offset, target, at, size)
      bytes = at + size
      copyEncoded = true
      return true
    },
    /** Requests mapping of the encoded copy. No effect on a frame that encoded none. */
    submitted() {
      if (!copyEncoded || disposed) return
      copyEncoded = false
      ring.submitted()
    },
    dispose() {
      disposed = true
      ready = false
      copyEncoded = false
      ring.destroy()
    },
  }
}
