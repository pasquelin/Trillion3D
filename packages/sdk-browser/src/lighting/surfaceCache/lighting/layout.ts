import { fieldLayout, vec4Array } from '../../../gpu/core/fieldLayout.ts'
import { CARD_TILE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { CARD_PAGE_WORDS } from '../../../../../sdk-core/src/lighting/surfaceCache/pageRecords.ts'
import type { AtlasFormat } from '../../lightFunction/renderWgsl.ts'

/**
 * WHAT THE SURFACE CACHE'S LIGHTING PASSES AND THEIR HOST AGREE ON: the numbers an image gives every kernel
 * (`LIGHTING_PARAMS`, one uniform written once an image) and the words of the update context's buffer, which
 * the kernels that choose the tiles to light write and every kernel after them reads.
 *
 * THE CONTEXT BUFFER. Header words first: for each of the two updates (`LIGHTING_CONTEXTS`, the direct light and the
 * radiosity) a histogram of the tiles each priority bucket holds, the cut (the last bucket listed and the tiles of it that
 * fit), the tiles given out and the tiles given out in the cut's bucket — a page counts its tiles whether or not
 * it fits, as the cut asks —, the pages listed and the tiles listed (the tiles the pages are cut into); the radiosity's
 * tiles and the arguments of the dispatches that follow the lists, `args`, four words each: a group a tile of the direct and
 * of the indirect list, the radiosity's traces and its probes (a thread each) and a group of 64 shadow traces. The lists
 * come after the header: the tiles of each update, a tile one word — its page in the low 24 bits, its tile along x and y in four bits each —, the
 * radiosity's tiles — the page in 22 bits, then 5 bits each of the probe's tile along x and y — and the pages of each
 * update, a page one word.
 */

/** The words of the header and where each part begins. */
export const CONTEXT_AT = {
  histogram: 0,
  maxBucket: 32,
  allocated: 36,
  listed: 40,
  radiosityTiles: 42,
  pagesListed: 44,
  args: 48,
} as const

/** The dispatch arguments of the header, in slots of 4 words from `CONTEXT_AT.args`: a group a tile of each list (the
 *  direct list's also the shadow masks'), the radiosity's traces and its probes (a thread each) and a group of 64
 *  shadow traces of the image. */
export const CONTEXT_ARGS = {
  directTiles: 0,
  indirectTiles: 1,
  traces: 2,
  probes: 3,
  shadowTraces: 4,
} as const

/** The words of the buffer of the dispatch arguments that cut each update's pages into tiles, a slot of 4 words an update
 *  (`LIGHTING_CONTEXTS`): the cut writes the context, and a dispatch cannot take its size from a buffer it writes. */
export const PAGE_ARGS_SLOT_WORDS = 4
export const PAGE_ARGS_WORDS = 2 * PAGE_ARGS_SLOT_WORDS

/** The words of the header: what a clear of the context writes. */
export const CONTEXT_HEADER_WORDS = 80

/** Where the lists begin and the words the buffer holds, for lists of the given capacities in tiles. A listed page has
 *  at least a tile, so each page list holds no more pages than its update has tiles. */
export function contextLayout(directTiles: number, indirectTiles: number, radiosityTiles: number) {
  const directAt = CONTEXT_HEADER_WORDS
  const indirectAt = directAt + directTiles
  const radiosityAt = indirectAt + indirectTiles
  const directPagesAt = radiosityAt + radiosityTiles
  const indirectPagesAt = directPagesAt + directTiles
  return {
    directAt,
    indirectAt,
    radiosityAt,
    directPagesAt,
    indirectPagesAt,
    words: indirectPagesAt + indirectTiles,
  }
}

/** The words of a page's record (`pageRecords.ts`) that hold the lighting's own state: the image of the last
 *  direct and the last indirect update (`lastUpdate`, two words) and the number of each (`temporal`, two words). */
export const PAGE_LIGHTING = {
  lastUpdate: CARD_PAGE_WORDS - 4,
  temporal: CARD_PAGE_WORDS - 2,
} as const

/**
 * THE SHADOW MASKS of the direct light. A tile of 8 × 8 texels keeps, for each light it is lit by, a mask of
 * `shadowMaskOf(format).tileWords` words: a texel is a byte (`'grey'`) — the light's factor on 7 bits (the light function and
 * the clouds' shade, then the ray's answer) — or, with the light functions' coloured atlas (`'colour'`), two bytes — the factor of
 * each of its three colour channels on 5 bits —; the top bit of the byte or the two bytes says whether the texel is settled. The texels whose mask is not
 * settled are listed as shadow traces: one word each after the count that opens the buffer, the light tile in the low
 * `SHADOW_TRACE.lightTileBits`, then the texel along x and along y in 3 bits each and the downsample
 * level in the bits above. The light tiles, a tile of the direct list and a light of it, keep where they are
 * (`SHADOW_LIGHT_TILE_WORDS` words each: the tile's page and tile word as the list holds it, the light's rank), so that a
 * trace finds its texel from its light tile alone. The tiles of the physical atlas keep, a
 * word of 256 lights a light's bit, whether every texel of the tile saw the light, or none did, at its last
 * update (`SHADOW_FACTOR_TILE_WORDS` words a tile).
 */
export const SHADOW_TEXELS = CARD_TILE_SIZE * CARD_TILE_SIZE
const TRACE_COORD_BITS = Math.log2(CARD_TILE_SIZE)
const TRACE_LIGHT_TILE_BITS = 24
const TRACE_DOWNSAMPLE_BITS = 2
/** The bits a texel's mask takes: 8 in the grey format, 16 in the colour one. */
const RAY_BITS = { grey: 8, colour: 16 } as const satisfies Record<AtlasFormat, number>
/** The shape of a mask in `format`: the bits of a texel, those of its factor (all but the one that says it is settled) and the
 *  words of a tile's mask. */
export const shadowMaskOf = (format: AtlasFormat) => {
  const rayBits = RAY_BITS[format]
  return {
    rayBits,
    factorBits: rayBits - 1,
    tileWords: (SHADOW_TEXELS * rayBits) / 32,
  }
}
/** The quads of four texels a tile holds. */
export const SHADOW_QUADS = SHADOW_TEXELS / 4
export const SHADOW_TRACE = {
  least: 1024,
  lightTileBits: TRACE_LIGHT_TILE_BITS,
  /** Where the texel along x and along y and the downsample level begin in a trace word. */
  xShift: TRACE_LIGHT_TILE_BITS,
  yShift: TRACE_LIGHT_TILE_BITS + TRACE_COORD_BITS,
  downsampleShift: TRACE_LIGHT_TILE_BITS + 2 * TRACE_COORD_BITS,
  /** The masks of a texel's coordinate, of the coordinate of the first texel of its quad, and of the downsample level. */
  coordMask: CARD_TILE_SIZE - 1,
  quadMask: CARD_TILE_SIZE - 2,
  downsampleMask: 2 ** TRACE_DOWNSAMPLE_BITS - 1,
} as const
export const SHADOW_LIGHT_TILE_WORDS = 2
export const SHADOW_FACTOR_TILE_WORDS = 8

/**
 * THE LIGHT FUNCTIONS THAT HOLD NO SLOT OF THE ATLAS, which the cache evaluates apart (`lightFunctionPassWgsl.ts`): a light
 * that wears one the atlas does not hold (the atlas is off, or the cache is not among its readers, or a limit left the light
 * out) is marked in the word that names it in its tile's list, the top bit, over the rank in its low `TILE_LIGHT_RANK_BITS`.
 * The function of such a light is evaluated at each texel of the tiles that keep it, before the masks, into the scratch: a half
 * float a texel, two to a word, `STANDALONE_SCRATCH_WORDS` words a light tile, after the masks of the light tiles in the same
 * buffer (`standaloneScratchAt` words in) or, where the shadows are not traced and there are no masks, alone in a buffer of
 * their own (`standaloneScratchWords`).
 */
export const TILE_LIGHT_RANK_BITS = 14
export const TILE_LIGHT_STANDALONE = 2 ** 31
export const STANDALONE_SCRATCH_WORDS = SHADOW_TEXELS / 2
/** The word of a buffer of masks, in `format`, for `lightTiles` light tiles, where the scratch of the light functions begins. */
export const standaloneScratchAt = (lightTiles: number, format: AtlasFormat) =>
  lightTiles * shadowMaskOf(format).tileWords
/** The words of a buffer that holds the scratch of `lightTiles` light tiles alone. */
export const standaloneScratchWords = (lightTiles: number) => lightTiles * STANDALONE_SCRATCH_WORDS

/** The words of each buffer the traced shadows keep for `lightTiles` light tiles (a tile of the direct list's, a
 *  light of its), their masks in `format`: what they are made at and what the device must hold. The masks are
 *  `shadowMaskOf(format).tileWords` a light tile, the scratch of the light functions after them where an image
 *  has any (`scratch`); the traces are one word for each texel of each, at least `SHADOW_TRACE.least`, after the
 *  count; the light tiles are `SHADOW_LIGHT_TILE_WORDS` each. */
export const tracedShadowWords = (lightTiles: number, format: AtlasFormat, scratch: boolean) => ({
  masks:
    standaloneScratchAt(lightTiles, format) + (scratch ? standaloneScratchWords(lightTiles) : 0),
  traces: 1 + Math.max(SHADOW_TEXELS * lightTiles, SHADOW_TRACE.least),
  lightTiles: lightTiles * SHADOW_LIGHT_TILE_WORDS,
})
/** The words of the factor atlas of a physical atlas of `side` texels. */
export const shadowFactorWords = (side: number) =>
  (side / CARD_TILE_SIZE) ** 2 * SHADOW_FACTOR_TILE_WORDS

/** The bits of the parameters' flags. */
export const LIGHTING_FLAG = {
  direct: 1,
  radiosity: 2,
  prioritizeFrustum: 4,
  filter: 8,
  temporal: 16,
  planeWeighting: 32,
  historyValid: 64,
  freezeUpdateFrame: 128,
  adaptiveShadowTracing: 256,
  forceTwoSided: 512,
  feedback: 1024,
  cullToTileDepthRange: 2048,
  probeOcclusion: 4096,
} as const

/** How a radiosity ray through the scene's triangles avoids the geometry it starts on, the setting
 *  `surfaceCacheHardwareRayTracingAvoidSelfIntersections` as it is: the back faces of the primitives that are not two-sided
 *  culled, the ray traced again from past a near back face or two-sided hit, or such hits passed as the ray travels — and 3,
 *  the best the traversal allows, passes them too, the scene trace's traversal being inline. */
export const SELF_INTERSECTION = { cull: 0, retrace: 1, skip: 2 } as const

/** The parameters of an image's lighting passes: the atlas and the pages, the update clock, the lists' places and
 *  capacities, the eye, the frustum (five planes, outward, in centimetres from the eye), the exposure the lights are strengthened
 *  under, where the scratch of the light functions begins in the masks' buffer, the direct light's numbers and the
 *  radiosity's, those of its rays through the scene's triangles among them (the biases, how far a hit is read from the cards and
 *  how near it lights nothing, in centimetres, and the way the ray avoids self-intersections). */
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
  ['directPagesAt', 'u32'],
  ['indirectPagesAt', 'u32'],
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
  ['traceRayBias', 'f32'],
  ['traceEndBias', 'f32'],
  ['radiosityRayBias', 'f32'],
  ['radiosityNormalBias', 'f32'],
  ['cardDepthBias', 'f32'],
  ['cardMinDistance', 'f32'],
  ['selfIntersections', 'u32'],
  ['probeOcclusionStrength', 'f32'],
  ['scratchAt', 'u32'],
  ['exposure', 'f32'],
  ['camera', 'vec4f'],
  ['eye', 'vec4f'],
  ['frustum', vec4Array(5)],
] as const)
