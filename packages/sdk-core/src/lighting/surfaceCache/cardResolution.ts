import { floorLog2, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { MAX_MESH_CARDS } from '../../contracts/meshBuildAbi.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'

/**
 * THE RESOLUTION OF A CARD: how many texels a card of the surface cache is kept at, from its size and
 * its distance from the eye, and how those texels are laid out in the atlas.
 *
 * The atlas is cut into physical pages of 128 × 128 texels. A card is kept at a RESOLUTION LEVEL
 * `L`, from 3 to 11: `2^L` texels along its longer side (8 to 2048). A level over 7 is cut into
 * virtual pages of 127 × 127 texels — each page a half texel wider on every side it shares with a
 * neighbour, so that a filtered read never leaves its page — and lives in as many physical pages; a
 * level of 7 or under is one part of one page, as small as 8 × 8. A card longer than wide keeps
 * the proportion: the level of its shorter side is lower by the proportion's log2 (`resLevelBias`).
 * A card's levels are its MIPS, the coarsest one always resident while the card is wanted.
 */

/** The side of a physical page, in texels. */
export const PAGE_SIZE = 128
/** The side of a virtual page: a physical page less its half texel on each side. */
export const VIRTUAL_PAGE_SIZE = 127
/** The least resolution, 2^MIN_RES_LEVEL texels, and the side of the unit a read of the page table
 *  gives its atlas position in. */
export const MIN_CARD_RESOLUTION = 8
/** The coarsest level a card is kept at. */
export const MIN_RES_LEVEL = 3
/** The finest level a card is kept at. */
export const MAX_RES_LEVEL = 11
/** The level whose card fills one physical page; finer is cut into virtual pages, coarser is
 *  part of one page. */
export const SUB_ALLOCATION_RES_LEVEL = 7
/** The levels a card has, one mip each. */
export const RES_LEVELS = 9
/** The side of a tile of a page the lighting works on, in texels. */
export const CARD_TILE_SIZE = 8
/** The bins a request's distance falls in. */
export const DISTANCE_BINS = 16
/** The directions a card faces along: -X, +X, -Y, +Y, -Z, +Z. */
export const AXIS_DIRECTIONS = 6
/** The cards a mesh keeps at most: the bits of the mask that names them, and the most the compiler
 *  keeps (`maxMeshCards`). */
export const MAX_CARDS_PER_MESH = MAX_MESH_CARDS
/** The least distance of a card from the eye its resolution is taken at. */
const NEAREST_DISTANCE = 100
/** The distance the bins start at: nearer requests all fall in the first. */
const BIN_BASE_DISTANCE = 1000
/** The bias of the proportion of a card is held to the levels there are above the least. */
const MAX_BIAS = 8
/** The greatest integer a bin is counted from, a distance the way a signed 32-bit word holds it. */
const MAX_BIN_OFFSET = 0x7fffffff

/** What the law needs of the settings and the view, taken once for a pass. */
export interface CardLimits {
  /** Texels per unit of length at a unit of distance. */
  readonly texelDensity: number
  /** The most texels per unit of length. */
  readonly maxTexelDensity: number
  /** The most texels along a side. */
  readonly maxResolution: number
  /** The least texels along a side a card is kept at, one at least. */
  readonly minResolution: number
  /** The farthest a card is kept from the eye. */
  readonly maxDistance: number
  /** The texels along a card's longer side that every card is given instead of the law's, for debugging; none while not above 0. */
  readonly fixedResolution: number
}

/** The greatest resolution a card is kept at: the setting, halved for a fast camera, scaled by the
 *  atlas's factor, one at least. */
export function cardMaxResolution(settings: SurfaceCacheSettings) {
  const wanted = settings.surfaceCacheCardMaxResolution
  const base = settings.surfaceCacheFastCameraMode ? Math.trunc(wanted / 2) : wanted
  return Math.max(1, Math.round(base * settings.surfaceCacheResolution))
}

/** The least resolution a card is kept at: the setting (an orthographic view's own where it is above
 *  0) over the scene's detail, scaled by the atlas's factor, between 1 and 1024. */
function cardMinResolution(settings: SurfaceCacheSettings, orthographic: boolean) {
  const own = orthographic ? settings.surfaceCacheOrthographicCardMinResolution : 0
  const least = own > 0 ? own : settings.surfaceCacheCardMinResolution
  const scaled = (least / settings.surfaceCacheSceneDetail) * settings.surfaceCacheResolution
  return clamp(Math.round(scaled), 1, 1024)
}

/**
 * The limits of the law for a view. `clipmapExtent` is the half side, in centimetres, of the
 * outermost clipmap of the global distance field: a card farther from the eye than that and the
 * capture margin is not kept.
 */
export function cardLimits(
  settings: SurfaceCacheSettings,
  orthographic: boolean,
  clipmapExtent: number,
): CardLimits {
  return {
    texelDensity:
      settings.surfaceCacheCardTexelDensityScale *
      settings.surfaceCacheResolution *
      (settings.surfaceCacheFastCameraMode ? 0.2 : 1),
    maxTexelDensity: settings.surfaceCacheCardMaxTexelDensity,
    maxResolution: cardMaxResolution(settings),
    minResolution: cardMinResolution(settings, orthographic),
    maxDistance: clipmapExtent + settings.surfaceCacheCardCaptureMargin,
    fixedResolution: settings.surfaceCacheCardFixedDebugResolution,
  }
}

/** The distance a card is taken to be at: the eye's distance from its box, at least a metre. */
export const viewerDistance = (boxDistance: number) => Math.max(boxDistance, NEAREST_DISTANCE)

/**
 * THE LAW: the level a card is kept at, or -1 if it is not kept. `maxExtent` is the larger of the
 * card's half sides, `distance` the eye's (`viewerDistance`), `resolutionScale` the mesh cards' own
 * factor, `minResolution` the least resolution this card is kept at (`limits.minResolution`, 1
 * for an emissive mesh).
 *
 * The texels along the longest side are the density over the distance, held to the greatest density
 * (or the fixed debugging resolution, `surfaceCacheCardFixedDebugResolution`, in its place) and to the greatest resolution, cut to a whole number and rounded up to a power of two; the card
 * is kept when that reaches the least resolution and the eye is within the greatest distance.
 */
export function cardResLevel(
  distance: number,
  maxExtent: number,
  resolutionScale: number,
  minResolution: number,
  limits: CardLimits,
) {
  if (!(distance < limits.maxDistance)) return -1
  const law = Math.min(
    (limits.texelDensity * maxExtent * resolutionScale) / distance,
    limits.maxTexelDensity * maxExtent,
  )
  const projected = limits.fixedResolution > 0 ? limits.fixedResolution : law
  const snapped = nextPow2(Math.min(Math.trunc(projected), limits.maxResolution))
  if (snapped < minResolution) return -1
  return floorLog2(Math.max(snapped, MIN_CARD_RESOLUTION))
}

/** The bin of a request at `distance` from the eye: the log2 of the distance past a thousand, the
 *  nearer ones in the first, the farthest in the last. */
export function distanceBin(distance: number) {
  const offset = clamp(Math.trunc(distance - BIN_BASE_DISTANCE), 1, MAX_BIN_OFFSET)
  return Math.min(floorLog2(offset), DISTANCE_BINS - 1)
}

/** The bias of one axis of a card's levels for the proportion `ratio` ≥ 1 of its longer side to its
 *  shorter: the log2 of the proportion rounded, held between 0 and the levels there are. */
function proportionBias(ratio: number) {
  return clamp(floorLog2(Math.max(1, Math.round(Math.min(ratio, 1e9)))), 0, MAX_BIAS)
}

/**
 * The levels a card's two axes lie below its level, from the proportion `aspect` of its half sides
 * (X over Y): the longer axis keeps the level, the shorter one lies lower by the log2 of the
 * proportion. Fixed when the card is made, the proportion being the placement's at that time.
 */
export function resLevelBias(aspect: number): readonly [x: number, y: number] {
  return aspect >= 1 ? [0, proportionBias(aspect)] : [proportionBias(1 / aspect), 0]
}

/** What a card's mip of one level is made of. */
export interface MipDesc {
  /** The level of each axis, from the card's level less its bias, held to the levels there are. */
  readonly resLevelX: number
  readonly resLevelY: number
  /** The virtual pages along each axis. */
  readonly sizeInPagesX: number
  readonly sizeInPagesY: number
  /** The texels along each axis of the mip. */
  readonly resolutionX: number
  readonly resolutionY: number
  /** The texels along each axis of one page of it: a whole physical page, or the part of one. */
  readonly pageResolutionX: number
  readonly pageResolutionY: number
  /** Whether the mip is a part of one physical page. */
  readonly subAllocation: boolean
}

/**
 * The mip of `resLevel` of a card whose axes lie `biasX` and `biasY` levels below it. A mip whose
 * either axis is over the level of one page is cut into pages of 127 texels (and each axis is at
 * least one page); any other is one part of one page, as many texels as its levels say.
 */
export function mipDesc(resLevel: number, biasX: number, biasY: number): MipDesc {
  let resLevelX = clamp(resLevel - biasX, MIN_RES_LEVEL, MAX_RES_LEVEL)
  let resLevelY = clamp(resLevel - biasY, MIN_RES_LEVEL, MAX_RES_LEVEL)
  if (resLevelX > SUB_ALLOCATION_RES_LEVEL || resLevelY > SUB_ALLOCATION_RES_LEVEL) {
    resLevelX = Math.max(resLevelX, SUB_ALLOCATION_RES_LEVEL)
    resLevelY = Math.max(resLevelY, SUB_ALLOCATION_RES_LEVEL)
    const sizeInPagesX = 2 ** (resLevelX - SUB_ALLOCATION_RES_LEVEL)
    const sizeInPagesY = 2 ** (resLevelY - SUB_ALLOCATION_RES_LEVEL)
    return {
      resLevelX,
      resLevelY,
      sizeInPagesX,
      sizeInPagesY,
      resolutionX: sizeInPagesX * VIRTUAL_PAGE_SIZE,
      resolutionY: sizeInPagesY * VIRTUAL_PAGE_SIZE,
      pageResolutionX: PAGE_SIZE,
      pageResolutionY: PAGE_SIZE,
      subAllocation: false,
    }
  }
  const resolutionX = 2 ** resLevelX
  const resolutionY = 2 ** resLevelY
  return {
    resLevelX,
    resLevelY,
    sizeInPagesX: 1,
    sizeInPagesY: 1,
    resolutionX,
    resolutionY,
    pageResolutionX: resolutionX,
    pageResolutionY: resolutionY,
    subAllocation: true,
  }
}

/** The texels the pages of a mip take in the atlas. */
export const mipTexels = (desc: MipDesc) =>
  desc.sizeInPagesX * desc.pageResolutionX * desc.sizeInPagesY * desc.pageResolutionY
