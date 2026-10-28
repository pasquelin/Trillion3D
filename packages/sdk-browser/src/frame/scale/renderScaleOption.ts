import { alignUp } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { displayResolutionFraction } from './displayResolutionFraction.ts'
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

/** The multiple the render targets' sides are made at, the one a feature that reads whole tiles of
 *  its image assumes. */
const TARGET_ALIGNMENT = 8

/** The rounding error a product of a scale and an axis may carry, which `Math.ceil` must not
 *  count as a pixel (0.7 × 2080 is 1456 whole). */
const PRODUCT_EPSILON = 1e-9

/** One display axis drawn at `scale`, the view's own: exactly that fraction of it rounded up, so a
 *  view is never empty, and the axis itself at 1. It is not aligned: only the targets are
 *  (`renderAllocation`), the passes work on the view. */
export const renderExtent = (display: number, scale: number) =>
  scale >= 1 ? display : clamp(Math.ceil(scale * display - PRODUCT_EPSILON), 1, display)

/** One display axis of the render targets that draw `renderExtent` in their corner: that extent
 *  rounded up to a multiple of eight, at most the display's own. */
export const renderAllocation = (display: number, scale: number) =>
  Math.min(display, alignUp(renderExtent(display, scale), TARGET_ALIGNMENT))
