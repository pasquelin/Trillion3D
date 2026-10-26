import type { HeldImage } from './litImage.ts'

/** A held image of `fields`, by default none: not valid, no view-projection, no size, the pre-exposure 1. */
export const heldImage = (fields: Partial<HeldImage> = {}): HeldImage => ({
  valid: false,
  viewProjection: new Float64Array(16),
  size: [0, 0],
  preExposure: 1,
  jitter: [0, 0],
  image: -1,
  ...fields,
})
