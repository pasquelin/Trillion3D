/**
 * What a ray that leaves the scene reaches where no sky is shown (`reflectionEnvironment`): the
 * background the screen draws — the declared colour or the default one — as the radiance it is. The
 * background is scene colour like every other pixel's: the lighting writes it into the lit image
 * (`surfaceColourMain`, `../deferred/colourPassWgsl.ts`) and the table shows it through the exposure and
 * the display curve, so a mirror that sees it adds the very radiance the screen holds there.
 */
import { srgbToLinear } from '../../../../math/src/color/color.ts'
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts'

/**
 * The reflection's surroundings (`ReflectionView.surroundings`): in `xyz`, the radiance of the
 * background colour `clearColor` (`0xrrggbb`), its channels read as the display's sRGB values they
 * are, made again only when the colour changes: a call allocates nothing.
 */
export function createSurroundings() {
  const words = new Float32Array(4)
  let colour = NaN
  return (clearColor: number) => {
    if (colour !== clearColor) {
      const { r, g, b } = clearValueOf(clearColor)
      words[0] = srgbToLinear(r)
      words[1] = srgbToLinear(g)
      words[2] = srgbToLinear(b)
      colour = clearColor
    }
    return words
  }
}
