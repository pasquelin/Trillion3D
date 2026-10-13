/**
 * What a mirror needs to show the background as the display shows it (`backgroundRadiance`): the
 * background is a display colour, drawn as it is behind the scene, and a ray that leaves the scene
 * reaches the radiance that the view's exposure and curve turn into that colour. It is computed
 * once, when the background, the exposure or the curve changes (`createSurroundings`), and the rays
 * read it from the reflection's view (`surroundings`).
 */
import { clearValueOf } from '../../../sdk-core/src/world/math/packedColour.ts'
import { srgbToLinear } from '../../../math/src/color/color.ts'
import { each, toneUnmap, type V3 } from './toneInverse.ts'

/** The display's white, half a byte below one: no byte tells it from the display of an infinite
 *  radiance, so the background is held below it. */
const BACKGROUND_WHITE = 254.5 / 255

/** The radiance the view shows as the background `clearColor` (`0xrrggbb`), through `exposure` and
 *  the curve of rank `curve`: what a ray that leaves the scene reaches. */
function backgroundRadiance(clearColor: number, exposure: number, curve: number): V3 {
  const { r, g, b } = clearValueOf(clearColor)
  const shown = each([r, g, b], (x) => srgbToLinear(Math.min(x, BACKGROUND_WHITE)))
  return each(toneUnmap(shown, curve), (x) => x / exposure)
}

/**
 * The reflection's surroundings (`ReflectionView.surroundings`): in `xyz`, the radiance of the
 * background the screen draws (`clearColor`, the declared colour or the default one) — what a ray
 * that leaves the scene reaches (`reflectionEnvironment`). Computed again only when the colour,
 * the exposure or the curve changes: a call that finds them as they were allocates nothing.
 */
export function createSurroundings() {
  const words = new Float32Array(4)
  let key: readonly [number, number, number] | undefined
  return (clearColor: number, exposure: number, curve: number) => {
    if (key && key[0] === clearColor && key[1] === exposure && key[2] === curve) return words
    key = [clearColor, exposure, curve]
    words.set(backgroundRadiance(clearColor, exposure, curve))
    return words
  }
}
