/** The key an encoder that times its passes answers `true` to (`../timing/encoder.ts`). */
export const TIMED_ENCODER = Symbol('timedEncoder')

/** Whether `encoder` times each of its passes: a frame sampled for the GPU timing. */
export const isTimed = (encoder: GPUCommandEncoder) =>
  (encoder as { [TIMED_ENCODER]?: boolean })[TIMED_ENCODER] === true

/**
 * Whether a timed `encoder` times each step of a compute run apart, a pass of its own with its label (`gpuTimingDetail`); otherwise the passes are the frame's own and a block is timed as one.
 * Read once when the sampled image opens (`TimingImage.apart`), and answered under this key by the encoder.
 */
export const TIMED_APART = Symbol('timedApart')

export const isTimedApart = (encoder: GPUCommandEncoder) =>
  isTimed(encoder) && (encoder as { [TIMED_APART]?: boolean })[TIMED_APART] === true
