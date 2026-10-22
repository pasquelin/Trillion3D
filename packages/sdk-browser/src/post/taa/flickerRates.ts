/** The share of the image a ghosting update of the flicker history takes, and the fade of its
 *  totals every image: 5 %. */
export const FLICKER_GHOSTING = 0.05
/** The flicker period, in images, below which a luma oscillation is a flicker. */
const FLICKER_PERIOD = 2
/** The periods a thin geometry region counts its flickers over (`thinGeometryWgsl.ts`). */
export const THIN_GEOMETRY_PERIODS = 3
/** The refresh rate, in hertz, below which the period shortens with the frame rate. */
const FLICKER_FRAME_RATE_CAP = 60

/** The frame's length against the 60 Hz cap's: one when unknown. */
const refreshShare = (intervalMs: number | null) =>
  intervalMs !== null && intervalMs > 0 ? (intervalMs / 1000) * FLICKER_FRAME_RATE_CAP : 1

/**
 * The flicker count's fade-in rate for a frame `intervalMs` long (`null`, unknown): `1 − 0.95^P`,
 * `P` the flicker period — two images, shortened in proportion where the frame rate falls below
 * 60 Hz, so an effect animated in time is not taken for a flicker at a low frame rate —, `periods`
 * of them (`THIN_GEOMETRY_PERIODS` in a thin geometry region).
 */
export function flickerCountRate(intervalMs: number | null, periods = 1) {
  const period = (periods * FLICKER_PERIOD) / Math.max(refreshShare(intervalMs), 1)
  return 1 - (1 - FLICKER_GHOSTING) ** period
}

/** The parallax speed, in render pixels an image, past which a texel is moving to the flicker
 *  measure: ten pixels of a 1920-wide image at the 60 Hz cap, in proportion to the frame's length
 *  and the render width. Its inverse is what the uniform holds (`view.rates.x`). */
export const flickerParallaxInverse = (renderWidth: number, intervalMs: number | null) =>
  1 / (refreshShare(intervalMs) * 10 * (renderWidth / 1920))
