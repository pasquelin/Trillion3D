/**
 * What a mirror needs to show the background as the display shows it (`backgroundRadiance`): the
 * background is a display colour, drawn as it is behind the scene, and a ray that leaves the scene
 * reaches the radiance that the view's exposure and curve turn into that colour. It is computed
 * once, when the background or the curve changes (`createSurroundings`), and the rays
 * read it from the reflection's view (`surroundings`).
 */
import { clearValueOf } from '../../../sdk-core/src/world/math/packedColour.ts'
import { srgbToLinear } from '../../../math/src/color/color.ts'
import { each, toneUnmap, type V3 } from './toneInverse.ts'

/** The display's white, half a byte below one: no byte tells it from the display of an infinite
 *  radiance, so the background is held below it. */
const BACKGROUND_WHITE = 254.5 / 255

/** The radiance the view shows as the background `clearColor` (`0xrrggbb`), at an exposure of 1,
 *  through the curve of rank `curve`: what the display value unmaps to (`toneUnmap`). The exposure
 *  divides it after, per image, where the unmapping stays. */
function backgroundRadiance(clearColor: number, curve: number): V3 {
  const { r, g, b } = clearValueOf(clearColor)
  const shown = each([r, g, b], (x) => srgbToLinear(Math.min(x, BACKGROUND_WHITE)))
  return toneUnmap(shown, curve)
}

/**
 * The reflection's surroundings (`ReflectionView.surroundings`): in `xyz`, the radiance of the
 * background the screen draws (`clearColor`, the declared colour or the default one) — what a ray
 * that leaves the scene reaches (`reflectionEnvironment`). The unmapping is computed again only
 * when the colour or the curve changes, and the exposure divides it each image, an automatic
 * exposure moving with the image: a call allocates nothing.
 */
export function createSurroundings() {
  const words = new Float32Array(4)
  let radiance: V3 = [0, 0, 0],
    colour = NaN,
    shape = NaN
  return (clearColor: number, exposure: number, curve: number) => {
    if (colour !== clearColor || shape !== curve) {
      radiance = backgroundRadiance(clearColor, curve)
      colour = clearColor
      shape = curve
    }
    words[0] = radiance[0] / exposure
    words[1] = radiance[1] / exposure
    words[2] = radiance[2] / exposure
    return words
  }
}
