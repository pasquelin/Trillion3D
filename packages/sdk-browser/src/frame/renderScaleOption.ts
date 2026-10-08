import { clamp, snap } from '../../../math/src/scalar/reals.ts'
/**
 * The render scale a page asks: the fraction of the display, per axis, the image is drawn at before
 * temporal antialiasing rebuilds it to the display. `'auto'` lets the frame budget choose it
 * between 0.5 and 1, `{ min, max }` bounds that choice, a number fixes it; every value is kept
 * within 0.5 and 1.
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

/** The bounds of `option`: fixed at 1 when absent, the display's own size. A page that names no
 *  minimum gets `MIN_RENDER_SCALE`, which temporal antialiasing reconstructs to the display. */
export function renderScaleBounds(option: RenderScale | undefined): RenderScaleBounds {
  if (option === 'auto') return { auto: true, min: MIN_RENDER_SCALE, max: 1 }
  if (option && typeof option === 'object') {
    const max = clampScale(option.max, 1)
    return { auto: true, min: Math.min(max, clampScale(option.min, MIN_RENDER_SCALE)), max }
  }
  const fixed = clampScale(option, 1)
  return { auto: false, min: fixed, max: fixed }
}

/** One display axis drawn at `scale`: the axis itself at 1, otherwise a multiple of eight, so a
 *  scale never lands on an odd size. */
export const renderExtent = (display: number, scale: number) =>
  scale >= 1 ? display : clamp(snap(scale * display, 8), 8, display)
