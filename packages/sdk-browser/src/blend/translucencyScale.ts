import { clamp } from '../../../math/src/scalar/reals.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { readSeparateTranslucencySetting as read } from '../../../sdk-core/src/contracts/separateTranslucencyOptions.ts'

/**
 * THE RESOLUTION OF THE TRANSLUCENT LAYERS (`translucency.ts`). The settings `translucencyScreenPercentage` and
 * `translucencyScreenPercentageBasis` name a fraction of a resolution; a fraction other than 1 draws the layers into targets of that fraction
 * of the image's size, over the scene's depth taken at their size (`translucencyDepth.ts`), and the composition scales them up
 * (`translucencyCompose.ts`). A side is the image's side times the fraction, cut to a whole number, one at the least.
 */

/** What the two settings name, read once for a use: the share of the resolution held to 0..1 and the basis (1: the display's). Rewritten by each
 *  read. */
const named = { share: 1, basis: 0 }
function readNamed(rt: Pick<WebgpuPagesRuntime, 'context'>) {
  named.share = clamp(read(rt, 'translucencyScreenPercentage') / 100, 0, 1)
  named.basis = read(rt, 'translucencyScreenPercentageBasis')
  return named
}

/** The extent of a `width × height` image at `fraction` of its size: a side is its side times the fraction, cut to a whole number, one
 *  at the least. */
const scaledExtent = (width: number, height: number, fraction: number): [number, number] => [
  Math.max(1, Math.trunc(width * fraction)),
  Math.max(1, Math.trunc(height * fraction)),
]

/** What the targets of the layers are made at: whether they are smaller than the image (`scaled`) and their extent. Unscaled, the
 *  extent is the targets' own, the image's. */
export interface TranslucencyExtent {
  readonly scaled: boolean
  readonly width: number
  readonly height: number
}

/** The extent the translucency targets of the runtime are made at for render targets of `allocated` size (the largest a frame is drawn at) and
 *  a display of `display` size. The layers are drawn at their own size only where it differs from the image's (the reference scales its
 *  translucency only when the rects differ): a share of 100 on the render basis, or on the display basis with the render targets the display's
 *  size and the frame never drawn below it (`apart` false), leaves them the image's, with none of the smaller layers' targets or programs.
 *  Where the frame may be drawn below the display (`apart`) the display basis keeps them, for the images whose rect then differs from the
 *  display's (`fitLayers` decides each image). With the display basis the extent follows the display, which the drawn size times the
 *  fraction keeps whatever the frame is drawn at. */
export function runtimeTranslucencyExtent(
  rt: Pick<WebgpuPagesRuntime, 'context'>,
  allocated: readonly [number, number],
  display: readonly [number, number],
  apart = false,
): TranslucencyExtent {
  const { share, basis } = readNamed(rt)
  const onDisplay = basis === 1
  const sameRect =
    !onDisplay || (!apart && allocated[0] === display[0] && allocated[1] === display[1])
  if (share === 1 && sameRect) return { scaled: false, width: allocated[0], height: allocated[1] }
  const [width, height] = scaledExtent(...(onDisplay ? display : allocated), share)
  return { scaled: true, width, height }
}

/** The fraction of the frame's drawn size (`drawn`) the layers are drawn at this image: the share; with the display basis (1) the share is of
 *  the display, so it is divided by the share of the display the image is drawn at (`drawn` over `display`, a side). */
export function runtimeTranslucencyFraction(
  rt: Pick<WebgpuPagesRuntime, 'context'>,
  drawn: readonly [number, number],
  display: readonly [number, number],
) {
  const { share, basis } = readNamed(rt)
  return basis === 1 && drawn[0] > 0 && display[0] > 0 ? (share * display[0]) / drawn[0] : share
}

/** A side of the image drawn at `side` pixels at `fraction`, held to the targets' own `limit`. */
export const drawnSide = (side: number, fraction: number, limit: number) =>
  clamp(Math.trunc(side * fraction), 1, limit)

/** Whether the composition scales with the nearest depth neighbour: the layers drawn at half the image's size (the ratio of the sides
 *  equal to a half) and the mode other than bilinear (`translucencyUpsampleMode`). */
export const nearestDepthUpsample = (mode: number, ratio: number) =>
  mode > 0 && Math.abs(ratio - 0.5) <= 1e-8

/** Whether the made translucency targets are those a frame asks for at `extent`: both unscaled, or both scaled to the same extent. */
export const translucencyFits = (
  targets: { active: boolean; reduced?: unknown; extent: readonly [number, number] } | undefined,
  extent: TranslucencyExtent,
) =>
  !targets?.active ||
  (!!targets.reduced === extent.scaled &&
    (!extent.scaled || (targets.extent[0] === extent.width && targets.extent[1] === extent.height)))
