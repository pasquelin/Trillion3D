import { fieldLayout, vec4Array } from '../../../gpu/core/fieldLayout.ts'

/**
 * WHAT THE SURFACE CACHE'S LIGHTING PASSES AND THEIR HOST AGREE ON: the numbers an image gives every kernel
 * (`LIGHTING_PARAMS`, one uniform written once an image) and the words of the update context's buffer, which
 * the kernels that choose the tiles to light write and every kernel after them reads.
 *
 * THE CONTEXT BUFFER. Header words first: for each of the two updates (`LIGHTING_CONTEXTS`, the direct light and the
 * radiosity) a histogram of the tiles each priority bucket holds, the cut (the last bucket listed and the tiles of it that
 * fit), the tiles given out and the tiles given out in the cut's bucket — a page counts its tiles whether or not
 * it fits, as the cut asks —, and the tiles listed; the radiosity's tiles and the arguments of the dispatches that
 * follow the lists, `args`, four words each: a group a tile of the direct and of the indirect list, the radiosity's
 * traces and its probes (a thread each). The lists come after the header: the tiles of each
 * update, a tile one word — its page in the low 24 bits, its tile along x and y in four bits each —, and the
 * radiosity's tiles — the page in 22 bits, then 5 bits each of the probe's tile along x and y.
 */

/** The words of the header and where each part begins. */
export const CONTEXT_AT = {
  histogram: 0,
  maxBucket: 32,
  allocated: 36,
  listed: 40,
  radiosityTiles: 42,
  args: 48,
} as const

/** The dispatch arguments of the header, in slots of 4 words from `CONTEXT_AT.args`. */
export const CONTEXT_ARGS = {
  directTiles: 0,
  indirectTiles: 1,
  traces: 2,
  probes: 3,
} as const

/** The words of the header: what a clear of the context writes. */
export const CONTEXT_HEADER_WORDS = 80

/** Where the lists begin and the words the buffer holds, for lists of the given capacities in tiles. */
export function contextLayout(directTiles: number, indirectTiles: number, radiosityTiles: number) {
  const directAt = CONTEXT_HEADER_WORDS
  const indirectAt = directAt + directTiles
  const radiosityAt = indirectAt + indirectTiles
  return { directAt, indirectAt, radiosityAt, words: radiosityAt + radiosityTiles }
}

/** The bits of the parameters' flags. */
export const LIGHTING_FLAG = {
  direct: 1,
  radiosity: 2,
  prioritizeFrustum: 4,
  filter: 8,
  temporal: 16,
  planeWeighting: 32,
  historyValid: 64,
} as const

/** The parameters of an image's lighting passes: the atlas and the pages, the update clock, the lists' places and
 *  capacities, the eye, the frustum (five planes, outward, in centimetres from the eye), the direct light's numbers and the
 *  radiosity's. */
export const LIGHTING_PARAMS = fieldLayout('LightingParams', [
  ['atlasSide', 'u32'],
  ['frame', 'u32'],
  ['pages', 'u32'],
  ['flags', 'u32'],
  ['directTiles', 'u32'],
  ['indirectTiles', 'u32'],
  ['directAt', 'u32'],
  ['indirectAt', 'u32'],
  ['radiosityAt', 'u32'],
  ['radiosityTiles', 'u32'],
  ['firstClipmapRcp', 'f32'],
  ['frustumDistance', 'f32'],
  ['maxLights', 'u32'],
  ['preExposure', 'f32'],
  ['shadowBias', 'f32'],
  ['maxTrace', 'f32'],
  ['spacing', 'u32'],
  ['spacingShift', 'u32'],
  ['hemisphere', 'u32'],
  ['filterKernel', 'u32'],
  ['planeDepthScale', 'f32'],
  ['maxFrames', 'u32'],
  ['fixedJitter', 'i32'],
  ['maxRayIntensity', 'f32'],
  ['surfaceBias', 'f32'],
  ['minTrace', 'f32'],
  ['camera', 'vec4f'],
  ['eye', 'vec4f'],
  ['frustum', vec4Array(5)],
] as const)
