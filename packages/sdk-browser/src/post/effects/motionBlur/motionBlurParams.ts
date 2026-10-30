import {
  MOTION_BLUR_SAMPLES,
  effectiveAmount,
  effectiveMax,
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
  /** The pass's settings, under the view's scale and overrides (`effectiveAmount`, `effectiveMax`). */
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
  /** Whether the filter writes the half-size image beside the blurred one, which the scene's chain
   *  reads: the last blur of the chain's, where its image lies in textures of its own size. */
  half?: boolean
  /** The size of the textures of the layers drawn after the motion blur, which the filter lays over
   *  the image it writes: the last pass of the last blur of the chain, where there are some. */
  layers?: readonly number[]
  /** The size those layers were drawn at, within their textures, where it is not the render grid's (drawn smaller,
   *  `translucencyScale.ts`): the filter reads them bilinear at the pixel's place in it. */
  drawn?: readonly number[]
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
 *   flipped; the longest streak, `max` percent of the image's width, half of it a side (the amount
 *   and the longest streak as the view sets them, `effectiveAmount`, `effectiveMax`); and the
 *   tile units a pixel of the grid is (`1 / FLATTEN_TILE` of the grid over the image's width, the
 *   grid's pixels in the image's);
 * - the tiles of motion and the filter tiles, across and down;
 * - the samples a pixel takes at most, whether a tile whose motion is longer than that many pixels
 *   is gathered at half the resolution, whether the samples may read the half-size image
 *   (`halfInput`: the setting's, but for the second pass of a separable blur, whose input has no
 *   half-size image), and whether the camera's motion is taken out;
 * - whether the filter writes the half-size image beside the blurred one (`half`), and whether it
 *   lays the layers drawn after the blur over it, where those lie (`layers`).
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
    half = false,
    layers,
    drawn = grid,
  }: MotionBlurInput,
) {
  const [width, height] = image
  const quality = settings.motionBlurQuality
  const samples = quality === 'off' ? 0 : MOTION_BLUR_SAMPLES[quality]
  const scale = timeScale * effectiveAmount(blur, settings) * 0.5
  into[AT.color] = width
  into[AT.color + 1] = height
  into[AT.color + 2] = 1 / width
  into[AT.color + 3] = 1 / height
  into[AT.scale] = width * 0.5 * scale
  into[AT.scale + 1] = -height * 0.5 * scale
  into[AT.scale + 2] = width * 0.5 * (effectiveMax(blur, settings) / 100)
  into[AT.scale + 3] = (1 / FLATTEN_TILE) * (grid[0] / width)
  ints[AT.tiles] = flattenTiles(grid[0])
  ints[AT.tiles + 1] = flattenTiles(grid[1])
  ints[AT.tiles + 2] = filterTiles(width)
  ints[AT.tiles + 3] = filterTiles(height)
  into[AT.knobs] = samples
  into[AT.knobs + 1] = Number(settings.motionBlurHalfResGather)
  into[AT.knobs + 2] = Number(halfInput)
  into[AT.knobs + 3] = Number(!blur.cameraMotion)
  into[AT.grid] = grid[0]
  into[AT.grid + 1] = grid[1]
  into[AT.outputs] = half ? 1 : 0
  into[AT.outputs + 1] = layers ? 1 : 0
  // The layers' texels a texel of the render grid spans over their textures' size (x, y), and the last texel centre drawn (z, w).
  into[AT.layers] = layers ? drawn[0] / grid[0] / layers[0] : 0
  into[AT.layers + 1] = layers ? drawn[1] / grid[1] / layers[1] : 0
  into[AT.layers + 2] = layers ? (drawn[0] - 0.5) / layers[0] : 0
  into[AT.layers + 3] = layers ? (drawn[1] - 0.5) / layers[1] : 0
}
