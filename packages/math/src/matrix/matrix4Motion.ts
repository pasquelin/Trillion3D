import { multiplyMatrix4 } from './matrix4.ts'
import { invertMatrix4 } from './matrix4Inverse.ts'

/**
 * Where an image's clip positions fell in the image before's: the view-projection `before` over the inverse of this one, written into
 * `out`. The identity where there is no image before. `current` and `inverse` are the caller's scratch matrices (`current` receives
 * the view-projection, `inverse` its inverse).
 */
export function clipToPreviousClip(
  out: Float64Array,
  current: Float64Array,
  inverse: Float64Array,
  viewProjection: ArrayLike<number>,
  before: Float64Array | undefined,
) {
  current.set(viewProjection)
  invertMatrix4(inverse, current)
  multiplyMatrix4(out, before ?? current, inverse)
}
