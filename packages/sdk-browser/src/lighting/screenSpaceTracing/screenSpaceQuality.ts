import type { ScreenReflectionQuality } from '../../../../sdk-core/src/contracts/screenSpaceTracingOptions.ts'
import { roughnessMaskScale } from './screenSpaceMask.ts'

/**
 * WHAT EACH LEVEL OF THE SCREEN-SPACE TRACES SPENDS: the reflections' rays and steps a pixel, the indirect light's rays, steps and the
 * tile of pixels one workgroup traces (its lanes: a pixel's rays side by side, 256 in all), and the geometry of the roughness mask.
 */

/** The shader's number of each reflection level (`SSR_QUALITY`), the checker 0. */
export const SCREEN_REFLECTION_LEVEL_CODE: Readonly<Record<ScreenReflectionQuality, number>> = {
  visualize: 0,
  low: 1,
  medium: 2,
  high: 3,
  veryHigh: 4,
}

/** The steps and rays of a pixel's march, and whether its rays are drawn over the glossy lobe, by level code (1 to 4); `denoised` is the
 *  medium level's one difference when the reflections go to a denoiser. */
export function screenReflectionMarch(code: number, denoised = false) {
  const row = MARCH_BY_CODE[Math.min(Math.max(code, 1), 4) - 1]
  return { ...row, glossy: row.glossy || (code === 2 && denoised) }
}
const MARCH_BY_CODE = [
  { steps: 8, rays: 1, glossy: false },
  { steps: 16, rays: 1, glossy: false },
  { steps: 8, rays: 4, glossy: true },
  { steps: 12, rays: 12, glossy: true },
] as const

/** The four numbers the reflections' pass reads: the intensity in 0..1, the roughness mask's scale, whether the discard is on, and the
 *  frame's turn — the temporal sample index (anti-aliasing that accumulates) or the frame index modulo 8, times 1551. */
export function screenReflectionParams(
  intensity: number,
  maxRoughness: number,
  code: number,
  enableDiscard: boolean,
  turn: number,
): [number, number, number, number] {
  return [
    Math.min(Math.max(intensity * 0.01, 0), 1),
    roughnessMaskScale(maxRoughness, code),
    enableDiscard ? 1 : 0,
    turn * 1551,
  ]
}

/** The indirect light's workgroup at a quality `level` (1 to 4, clamped): the rays a pixel casts, the steps of each, and the tile of pixels
 *  a group traces, whose lanes (tile · rays) are 256. */
export function screenGiConfig(level: number) {
  const quality = Math.min(Math.max(Math.trunc(level), 1), 4)
  const { rays, steps, tile } = GI_BY_QUALITY[quality - 1]
  return { quality, rays, steps, tileX: tile[0], tileY: tile[1] }
}
const GI_BY_QUALITY = [
  { rays: 4, steps: 8, tile: [8, 8] },
  { rays: 8, steps: 8, tile: [8, 4] },
  { rays: 16, steps: 8, tile: [4, 4] },
  { rays: 32, steps: 12, tile: [4, 2] },
] as const

/** The tile of pixels that classifies a reflection pass, and the reduced chain's levels of the last lit image. */
export const SCREEN_SPACE_GROUP_SIDE = 8
/** Threads of a square workgroup of that side, and the bits a word of the tiles' mask holds. */
export const SCREEN_SPACE_GROUP_THREADS = SCREEN_SPACE_GROUP_SIDE * SCREEN_SPACE_GROUP_SIDE
export const TILE_MASK_BITS = 32
/** Bytes of the mask of `tiles` tiles, one bit each, at least one word. */
export const tileMaskBytes = (tiles: number) => 4 * Math.max(1, Math.ceil(tiles / TILE_MASK_BITS))
export const REDUCED_COLOR_MIPS = 5
/** The levels the last lit image skips at the start of its reduced chain: the chain starts at half the image's size. */
const REDUCED_COLOR_SKIPPED_MIPS = 1

/** The size of the reduced chain's first level for a depth of `width × height`: half, rounded up to a multiple of 2^(levels − 1). */
export function reducedColorSize(width: number, height: number) {
  const multiple = 1 << (REDUCED_COLOR_MIPS - 1)
  const half = (n: number) => Math.floor(n / (1 << REDUCED_COLOR_SKIPPED_MIPS))
  return [
    multiple * Math.ceil(half(width) / multiple),
    multiple * Math.ceil(half(height) / multiple),
  ] as const
}

/** Where a texel of the image held lies in its buffer: the scale and bias of a clip position (−1..1, y up) of the last image, to a
 *  texture coordinate of the history, for the rectangle of `extent` pixels at `offset` of a buffer of `buffer` pixels. */
export function previousScreenScaleBias(
  extent: readonly [number, number],
  offset: readonly [number, number],
  buffer: readonly [number, number],
): [number, number, number, number] {
  return [
    (extent[0] * 0.5) / buffer[0],
    (-extent[1] * 0.5) / buffer[1],
    (extent[0] * 0.5 + offset[0]) / buffer[0],
    (extent[1] * 0.5 + offset[1]) / buffer[1],
  ]
}

/** The scale of the world radius of one pixel at a depth: `[a, b]`, the radius being `a · depth + b` — the tangent of half the field over the
 *  width under a perspective, a unit under an orthographic projection. */
export function pixelRadiusScale(
  perspective: boolean,
  tanHalfFov: number,
  width: number,
): [number, number] {
  return perspective ? [tanHalfFov / width, 0] : [0, tanHalfFov]
}

/** The colour scale and bias of the reduced chain: the clip-space coordinates of the reduced colour of a screen texture coordinate, and the
 *  last texel of the reduced colour a hit may read. `bufferWidth × bufferHeight` is the depth's extent, `reduced` the chain's first level. */
export function reducedColorScaleBias(
  bufferSize: readonly [number, number],
  viewSize: readonly [number, number],
  viewMin: readonly [number, number],
  reduced: readonly [number, number],
) {
  return {
    scaleBias: [
      (0.5 * bufferSize[0]) / reduced[0],
      (0.5 * bufferSize[1]) / reduced[1],
      (-0.5 * viewMin[0]) / reduced[0],
      (-0.5 * viewMin[1]) / reduced[1],
    ] as [number, number, number, number],
    uvMax: [(0.5 * viewSize[0] - 0.5) / reduced[0], (0.5 * viewSize[1] - 0.5) / reduced[1]] as [
      number,
      number,
    ],
  }
}
