import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'

/** A rectangle of the drawn image: first column and row, one past the last. */
export type SelfShadowRect = readonly [number, number, number, number]

/** The low-resolution texels the trace and the filter run beyond the window's rim, so that the filter and the upsample find the texels they read traced: the upsample reads the
 *  texel round a pixel and the filter the ring round each of them. */
export const WINDOW_MARGIN = 2

/**
 * The windows of a run over `rect` of an image of `size` pixels: the low-resolution one (the rect at half the resolution, with the margin, held to the grid of
 * `lowSize`) the trace and the filter cover, and the rect itself the full-resolution kernels cover. Each as first column and row, one past the last.
 */
export function selfShadowWindows(
  rect: SelfShadowRect,
  lowSize: readonly [number, number],
): { low: SelfShadowRect; full: SelfShadowRect } {
  const [x0, y0, x1, y1] = rect
  return {
    low: [
      Math.max(0, (x0 >> 1) - WINDOW_MARGIN),
      Math.max(0, (y0 >> 1) - WINDOW_MARGIN),
      Math.min(lowSize[0], ceilDiv(x1, 2) + WINDOW_MARGIN),
      Math.min(lowSize[1], ceilDiv(y1, 2) + WINDOW_MARGIN),
    ],
    full: rect,
  }
}
