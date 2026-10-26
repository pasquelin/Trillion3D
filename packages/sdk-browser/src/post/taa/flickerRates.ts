import {
  TEMPORAL_DEFAULTS,
  type TemporalValues,
} from '../../../../sdk-core/src/contracts/temporalOptions.ts'

/** The share of the image a ghosting update of the flicker history takes, and the fade of its
 *  totals every image: 5 %. */
export const FLICKER_GHOSTING = 0.05
/** The periods a thin geometry region counts its flickers over (`thinGeometryWgsl.ts`). */
export const THIN_GEOMETRY_PERIODS = 3

/** The settings the flicker measure takes (`temporalFlickeringPeriod` and its neighbours,
 *  `../../../../sdk-core/src/contracts/temporalOptions.ts`). */
export type FlickerSettings = Pick<
  TemporalValues,
  | 'temporalFlickeringPeriod'
  | 'temporalFlickeringAdjustToFrameRate'
  | 'temporalFlickeringFrameRateCap'
  | 'temporalFlickeringMaxParallaxVelocity'
>

/** The frame's length against the frame rate cap's — 60 Hz by default —: one when unknown, or
 *  where the period does not follow the frame rate. */
const refreshShare = (intervalMs: number | null, settings: FlickerSettings) =>
  settings.temporalFlickeringAdjustToFrameRate && intervalMs !== null && intervalMs > 0
    ? (intervalMs / 1000) * settings.temporalFlickeringFrameRateCap
    : 1

/**
 * The flicker count's fade-in rate for a frame `intervalMs` long (`null`, unknown): `1 − 0.95^P`,
 * `P` the flicker period — two images by default, shortened in proportion where the frame rate falls
 * below the cap, 60 Hz by default, so an effect animated in time is not taken for a flicker at a
 * low frame rate —, `periods` of them (`THIN_GEOMETRY_PERIODS` in a thin geometry region).
 */
export function flickerCountRate(
  intervalMs: number | null,
  periods = 1,
  settings: FlickerSettings = TEMPORAL_DEFAULTS,
) {
  const period =
    (periods * settings.temporalFlickeringPeriod) / Math.max(refreshShare(intervalMs, settings), 1)
  return 1 - (1 - FLICKER_GHOSTING) ** period
}

/** The parallax speed, in render pixels an image, past which a texel is moving to the flicker
 *  measure: the setting's pixels of a 1920-wide image — ten by default — at the frame rate cap, in
 *  proportion to the frame's length and the render width. Its inverse is what the uniform holds
 *  (`view.rates.x`). */
export const flickerParallaxInverse = (
  renderWidth: number,
  intervalMs: number | null,
  settings: FlickerSettings = TEMPORAL_DEFAULTS,
) =>
  1 /
  (refreshShare(intervalMs, settings) *
    settings.temporalFlickeringMaxParallaxVelocity *
    (renderWidth / 1920))
