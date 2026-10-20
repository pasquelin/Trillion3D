import type { HeldImage } from './radiance.ts'

/** A held image of `fields`, by default none: not valid, no view-projection, no size. */
export const heldImage = (fields: Partial<HeldImage> = {}): HeldImage => ({
  valid: false,
  viewProjection: new Float64Array(16),
  size: [0, 0],
  ...fields,
})
