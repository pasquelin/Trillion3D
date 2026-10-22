import {
  MOTION_BLUR_SAMPLES,
  type MotionBlurValues,
  type ResolvedMotionBlur,
} from '../../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import {
  FLATTEN_TILE,
  GATHER_REACH,
  MOTION_BLUR_PARAMS,
  filterTiles,
  flattenTiles,
} from './motionBlurLayout.ts'

/** The `x`th word of a field of the uniform (`MOTION_BLUR_PARAMS`). */
const AT = MOTION_BLUR_PARAMS.at

/** What the uniform is written from, refilled at each image. */
export interface MotionBlurInput {
  /** The pass's settings. */
  blur: ResolvedMotionBlur
  /** How the blur is drawn (`MOTION_BLUR_RULES`). */
  settings: MotionBlurValues
  /** The size of the image to blur, in pixels. */
  image: readonly number[]
  /** The grid the motion was measured on, this image's render grid. */
  grid: readonly number[]
  /** The ratio of the frame the streak is relative to to the frame the image has (`timeScale`). */
  timeScale: number
  /** Whether the samples may read the half-size image: the setting's where left out. */
  halfInput?: boolean
}

/**
 * Whether the largest motion of each tile is spread over the tiles it crosses by drawing it: when
 * the view asks for it (`scatter`, `motionBlurScatter`), or when the longest streak — `max`
 * percent of the image's width, half of it a side, in tiles of `FLATTEN_TILE` pixels — is longer
 * than the tiles the reading of the neighbours reaches (`GATHER_REACH`).
 */
export const spreadsByDrawing = (max: number, scatter: boolean, width: number) =>
  scatter || (max / 100) * width * (0.5 / FLATTEN_TILE) > GATHER_REACH

/**
 * Writes the uniform's words (`MOTION_BLUR_PARAMS`) into `into`, each an `f32` or a `u32` (`ints`):
 * - the image's size, with its inverses, and the motion grid's;
 * - the scale that takes a motion in device units to pixels of the image: the image's half size
 *   times the time scale, the amount and one half — a streak goes both ways —, the vertical axis
 *   flipped; the longest streak, `max` percent of the image's width, half of it a side; and the
 *   tile units a pixel of the grid is (`1 / FLATTEN_TILE` of the grid over the image's width, the
 *   grid's pixels in the image's);
 * - the tiles of motion and the filter tiles, across and down;
 * - the samples a pixel takes at most, whether a tile whose motion is longer than that many pixels
 *   is gathered at half the resolution, whether the samples may read the half-size image
 *   (`halfInput`: the setting's, but for the second pass of a separable blur, whose input has no
 *   half-size image), and whether the camera's motion is taken out.
 */
export function writeMotionBlurParams(
  into: Float32Array,
  ints: Uint32Array,
  {
    blur,
    settings,
    image,
    grid,
    timeScale,
    halfInput = settings.motionBlurHalfResInput,
  }: MotionBlurInput,
) {
  const [width, height] = image
  const quality = settings.motionBlurQuality
  const samples = quality === 'off' ? 0 : MOTION_BLUR_SAMPLES[quality]
  const scale = timeScale * blur.amount * 0.5
  into.set([width, height, 1 / width, 1 / height], AT.color)
  into.set(
    [
      width * 0.5 * scale,
      -height * 0.5 * scale,
      width * 0.5 * (blur.max / 100),
      (1 / FLATTEN_TILE) * (grid[0] / width),
    ],
    AT.scale,
  )
  ints.set(
    [flattenTiles(grid[0]), flattenTiles(grid[1]), filterTiles(width), filterTiles(height)],
    AT.tiles,
  )
  const knobs = [settings.motionBlurHalfResGather, halfInput, !blur.cameraMotion]
  into.set([samples, ...knobs.map(Number)], AT.knobs)
  into.set([grid[0], grid[1]], AT.grid)
}
