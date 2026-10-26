/**
 * THE HORIZON SEARCH'S DATA: what a shader quality fixes (the steps along a direction and the coarsest level the first
 * steps read), the farthest a search reaches in pixels, the turn of the directions and the offset of the steps from
 * image to image, and the weights of the spatial filter. Pure data, written once; the shaders (`searchWgsl.ts`,
 * `filterWgsl.ts`) and the host (`params.ts`) read the same tables.
 */

/** A quality's shape: the steps along each side of a direction, and the level of the depth pyramid the steps start at
 *  (0 the half-size cells). */
interface HorizonQualityShape {
  readonly taps: number
  readonly biasLevel: number
}

/** The shapes of the five shader qualities, 0 (the fewest steps) to 4. */
export const HORIZON_QUALITY_SHAPES: readonly HorizonQualityShape[] = [
  { taps: 4, biasLevel: 2 },
  { taps: 6, biasLevel: 1 },
  { taps: 8, biasLevel: 0 },
  { taps: 12, biasLevel: 0 },
  { taps: 20, biasLevel: 0 },
]

/** The farthest, in pixels, a direction's search reaches, whatever the radius. */
export const HORIZON_MAX_PIXEL_RADIUS = 256

/** The turn of the directions, image after image over six — half each of these angles in degrees —, and the offsets of the
 *  steps' phase, over four (the phase takes the next each six images). */
export const HORIZON_TURNS_DEGREES = [60, 300, 180, 240, 120, 0] as const
export const HORIZON_STEP_OFFSETS = [0.1, 0.6, 0.35, 0.85] as const

/** How much of a pixel's depth plane the spatial filter tolerates: a neighbour's weight is `1 − |Δ| · this`, over the
 *  difference of the device depths, held from 0 to 1. */
export const HORIZON_PLANE_WEIGHT = 20000

/** The spatial filter's workgroup: its pixels across and down, and the border of texels it reads past them, so that the group
 *  loads the occlusion and the depth of its tile once and reads the rest from the group's memory. */
export const HORIZON_GROUP = [16, 8] as const
export const HORIZON_BORDER = 2
/** The tile the group loads: the group's pixels and the border either side, across, down, and in all. */
export const HORIZON_TILE = [
  HORIZON_GROUP[0] + 2 * HORIZON_BORDER,
  HORIZON_GROUP[1] + 2 * HORIZON_BORDER,
] as const
export const HORIZON_TILE_TEXELS = HORIZON_TILE[0] * HORIZON_TILE[1]
