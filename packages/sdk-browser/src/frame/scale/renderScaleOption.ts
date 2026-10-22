import { clamp, snap } from '../../../../math/src/scalar/reals.ts'
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

/** One display axis drawn at `scale`: the axis itself at 1, otherwise a multiple of eight, so a
 *  scale never lands on an odd size. */
export const renderExtent = (display: number, scale: number) =>
  scale >= 1 ? display : clamp(snap(scale * display, 8), 8, display)
