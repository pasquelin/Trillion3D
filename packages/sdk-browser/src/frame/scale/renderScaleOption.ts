import { clamp, snap } from '../../../../math/src/scalar/reals.ts'
/**
 * The render scale a page asks: the fraction of the display, per axis, the image is drawn at before
 * temporal antialiasing rebuilds it to the display. Absent, the default for the display's
 * resolution (`displayResolutionFraction`); `'auto'` lets the frame budget choose it between 0.5
 * and that default, `{ min, max }` bounds that choice (`max` that default when absent), a number
 * fixes it — 1, the display's own size. Every value is kept within 0.5 and 1.
 */
export type RenderScale = number | 'auto' | { min?: number; max?: number }

/** Smallest render scale: half the display per axis. */
export const MIN_RENDER_SCALE = 0.5

/** What a page's `RenderScale` asks, in `[MIN_RENDER_SCALE, 1]`: the controller's bounds, or one
 *  scale (`min` = `max`) when it is fixed. */
export interface RenderScaleBounds {
  auto: boolean
  min: number
  max: number
}

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

/** A fraction in `[MIN_RENDER_SCALE, 1]`; `fallback` when absent or not a number. */
const clampScale = (value: number | undefined, fallback: number) =>
  value === undefined || Number.isNaN(value) ? fallback : clamp(value, MIN_RENDER_SCALE, 1)

/** The bounds of `option` on a display of `displayPixels`: fixed at the default fraction of
 *  it when absent (`displayResolutionFraction`), which also caps the controller's choice when the
 *  page names no maximum. A page that names no minimum gets `MIN_RENDER_SCALE`, which temporal
 *  antialiasing reconstructs to the display. */
export function renderScaleBounds(
  option: RenderScale | undefined,
  displayPixels: number,
): RenderScaleBounds {
  const fallback = clampScale(displayResolutionFraction(displayPixels), 1)
  if (option === 'auto') return { auto: true, min: MIN_RENDER_SCALE, max: fallback }
  if (option && typeof option === 'object') {
    const max = clampScale(option.max, fallback)
    return { auto: true, min: Math.min(max, clampScale(option.min, MIN_RENDER_SCALE)), max }
  }
  const fixed = clampScale(option, fallback)
  return { auto: false, min: fixed, max: fixed }
}

/** One display axis drawn at `scale`: the axis itself at 1, otherwise a multiple of eight, so a
 *  scale never lands on an odd size. */
export const renderExtent = (display: number, scale: number) =>
  scale >= 1 ? display : clamp(snap(scale * display, 8), 8, display)
