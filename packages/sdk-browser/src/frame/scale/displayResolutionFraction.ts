import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The pixels of a 16:9 image `height` tall: the tiers are pixel counts, so a display of any
 *  aspect ratio falls between them by its area. */
const pixels169 = (height: number) => height * height * (1920 / 1080)
/** The display heights 720, 2160 and 4320 render 720, 1080 and 1440 tall, as 16:9 pixel counts:
 *  the denser the display, the less of each pixel the eye resolves and the more temporal
 *  antialiasing can rebuild. */
const DISPLAY_TIERS = [720, 2160, 4320].map(pixels169),
  RENDER_TIERS = [720, 1080, 1440].map(pixels169)

/**
 * The default render fraction on the display, based on its resolution: the rendered pixel count
 * follows the display's, `pixels`
 * — the view's drawing-buffer pixels —, at the tiers' ratio below the first and above the last,
 * interpolated between two tiers; the fraction per axis is the square root of their ratio. A
 * 3840×2160 display renders at 0.5 per axis, a 1920×1080 one at ~0.73, one 720 tall or less at
 * 1.
 */
export function displayResolutionFraction(pixels: number) {
  const shown = Math.max(1, pixels),
    [d0, d1, d2] = DISPLAY_TIERS,
    [r0, r1, r2] = RENDER_TIERS
  let rendered: number
  if (shown < d0) rendered = (shown * r0) / d0
  else if (shown > d2) rendered = (shown * r2) / d2
  else {
    const upper = shown > d1,
      lo = upper ? d1 : d0,
      hi = upper ? d2 : d1,
      from = upper ? r1 : r0,
      to = upper ? r2 : r1
    rendered = from + (to - from) * clamp((shown - lo) / (hi - lo), 0, 1)
  }
  return Math.sqrt(rendered / shown)
}
