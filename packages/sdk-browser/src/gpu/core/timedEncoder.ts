/** The key an encoder that times its passes answers `true` to (`../timing/encoder.ts`). */
export const TIMED_ENCODER = Symbol('timedEncoder')

/** Whether `encoder` times each of its passes: a frame sampled for the GPU timing. */
export const isTimed = (encoder: GPUCommandEncoder) =>
  (encoder as { [TIMED_ENCODER]?: boolean })[TIMED_ENCODER] === true
