import { clampLowWins } from '../../../../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { VSM_LEVEL0_TEXELS, VSM_MIPS, VSM_PAGE_TEXELS } from '../../vsm/constants.ts'

/**
 * THE TILES OF THE CLASSIC DEPTH ATLAS (`shadowVirtualEnable` off): each map a frame draws takes one square tile of the atlas, placed by shelves (rows of equal-height tiles, the
 * tallest first). The words of the tile table the shaders read are written here: for the map's id, the tile's corner in the atlas, its side, and the mip of the map it holds. The corner of
 * the tile in the map itself (where its first texel lies in the map's own texels) is not known here: a cascade's tile follows its sphere, which only the GPU knows; the shaders
 * take it from the page rect the dense marking wrote in the words before the tile's (`ATLAS_RECT_WORDS`).
 */

/** The words a map holds in the atlas buffer: first the page rect the dense marking writes (`ATLAS_RECT_WORDS`, see `vsmMarkDense`), then its tile: atlas corner (x | y << 16), side, mip,
 *  whether the map has a tile, its flags (`ATLAS_TILE_NO_DYNAMIC`), the atlas's width and height, the atlas it lies in (page), then the depth bias the draw gives the map
 *  (`DrawBias`, three floats). */
export const ATLAS_MAP_WORDS = 15
/** The words of a map's page rect: the complement of the first page's x and y, the last page's x and y; zero while no entry asks. */
export const ATLAS_RECT_WORDS = 4
/** The tile's flag that leaves the movable casters' records out of the map (`shadowCachedCastFromMovable` off for a local light). */
export const ATLAS_TILE_NO_DYNAMIC = 1
/** The first word of map `mapId`'s tile in the atlas buffer. */
export const atlasTileAt = (mapId: number) => mapId * ATLAS_MAP_WORDS + ATLAS_RECT_WORDS

/** A map to give a tile: its id, the mip of the map the tile holds and the side of the tile in texels. */
export interface AtlasMap {
  readonly mapId: number
  readonly mip: number
  readonly side: number
  /** Leave the movable casters out of this map (`ATLAS_TILE_NO_DYNAMIC`). */
  readonly noDynamic?: boolean
  /** The depth bias the casters are drawn with in this map; none when absent. */
  readonly bias?: DrawBias
}

/**
 * The depth bias of a map's casters, applied where they are drawn (per vertex, from the vertex's normal against the light's axis): `constant` distance units, grown by `slope` times
 * the slope of the surface (held to `maxSlope`) as `constant * (1 + slope * surfaceSlope)`.
 */
export interface DrawBias {
  readonly constant: number
  readonly slope: number
  readonly maxSlope: number
}

/** The side of a tile that holds `texels` texels of a map, up to the page: tiles hold whole pages. */
export const tileSide = (texels: number) =>
  Math.max(1, ceilDiv(Math.max(texels, 1), VSM_PAGE_TEXELS)) * VSM_PAGE_TEXELS

/** The side of the tile of a local light's map drawn at `resolution` texels: the mip's own side (`localMip`) at most the map's. */
export const localTileSide = (mip: number) =>
  Math.max(VSM_LEVEL0_TEXELS >> Math.min(mip, VSM_MIPS - 1), VSM_PAGE_TEXELS)

/** What `planAtlas` made: the tiles placed, those left out (a tile larger than an atlas can be), the atlases there are (pages) and the extent every one is drawn in. */
export interface AtlasPlan {
  readonly words: Uint32Array<ArrayBuffer>
  readonly placed: number
  readonly left: readonly number[]
  readonly pages: number
  readonly width: number
  readonly height: number
}

/**
 * Places `maps` in at most `maxPages` atlases of at most `limit` texels a side: the tallest first, along rows, a row as high as its first tile, an atlas filled before the next is opened, as the reference
 * opens a new atlas when a shadow finds no room in the last. The buffer has `mapCount` rows of `ATLAS_MAP_WORDS` (a map's id its row, the page rect zero and the tile all zero where
 * it has none). Every atlas is drawn in the extent of the widest and the highest, so the tiles carry one size.
 */
export function planAtlas(
  maps: readonly AtlasMap[],
  mapCount: number,
  limit: number,
  maxPages = Infinity,
): AtlasPlan {
  const words = new Uint32Array(mapCount * ATLAS_MAP_WORDS)
  const floats = new Float32Array(words.buffer)
  const order = maps.slice().sort((a, b) => b.side - a.side || a.mapId - b.mapId)
  const left: number[] = []
  let page = 0
  let x = 0
  let y = 0
  let rowHeight = 0
  let width = 0
  let height = 0
  let placed = 0
  for (const map of order) {
    if (map.side > limit || map.mapId >= mapCount) {
      left.push(map.mapId)
      continue
    }
    // Where the map would lie: a new row if this one is full, a new atlas if that is. Taken only once it is placed, so a map left out moves nothing.
    let nx = x
    let ny = y
    let nRow = rowHeight
    let nPage = page
    if (nx + map.side > limit) {
      ny += nRow
      nx = 0
      nRow = 0
    }
    if (ny + map.side > limit) {
      // The memory affords no atlas more: this map and the smaller ones after it are left out.
      if (nPage + 1 >= maxPages) {
        left.push(map.mapId)
        continue
      }
      nPage++
      nx = ny = nRow = 0
    }
    x = nx
    y = ny
    rowHeight = nRow
    page = nPage
    if (rowHeight === 0) rowHeight = map.side
    const at = atlasTileAt(map.mapId)
    words[at] = (x | (y << 16)) >>> 0
    words[at + 1] = map.side
    words[at + 2] = map.mip
    words[at + 3] = 1
    words[at + 4] = map.noDynamic ? ATLAS_TILE_NO_DYNAMIC : 0
    words[at + 7] = page
    floats[at + 8] = map.bias?.constant ?? 0
    floats[at + 9] = map.bias?.slope ?? 0
    floats[at + 10] = map.bias?.maxSlope ?? 0
    x += map.side
    width = Math.max(width, x)
    height = Math.max(height, y + rowHeight)
    placed++
  }
  // Every tile carries the extent the atlases are drawn in, which the vertex stage maps to the target's clip space by.
  for (const map of order) {
    const at = atlasTileAt(map.mapId)
    if (words[at + 3]) {
      words[at + 5] = width
      words[at + 6] = height
    }
  }
  return { words, placed, left, pages: placed ? page + 1 : 0, width, height }
}

/** The layers an atlas holds: the movable casters' and, while the static depths are kept (`cached`), the static casters'. */
export const atlasLayers = (cached: boolean) => (cached ? 2 : 1)

/**
 * The resolution a sun's cascades are drawn at: the setting's `requested`, held to what a tile of the atlas of side `atlasSide` takes (the cascade's square and a page more, so a page
 * less than the atlas's side). A cascade the atlas could not hold is drawn at a coarser level of the clipmap, never left without its shadow.
 */
export const cascadeResolutionIn = (requested: number, atlasSide: number) =>
  clampLowWins(requested, VSM_PAGE_TEXELS, atlasSide - VSM_PAGE_TEXELS)

/** The atlas settings the cascades' resolution is held by. */
export interface CascadeAtlasSettings {
  readonly shadowMaxCsmResolution: number
  readonly shadowWholeSceneCacheMb: number
  readonly shadowCacheWholeScene: boolean
}

/** The resolution a sun's cascades are drawn at in the atlas the settings and the device make (`cascadeResolutionIn`). */
export const classicCascadeResolution = (s: CascadeAtlasSettings, maxTextureSide: number) =>
  cascadeResolutionIn(
    s.shadowMaxCsmResolution,
    atlasBudget(maxTextureSide, s.shadowWholeSceneCacheMb, s.shadowCacheWholeScene).side,
  )

/**
 * The size of the atlases: the most texels a side an atlas takes and the most atlases there are. The device's texture limit holds the side; while the static layer is kept (`cached`), the
 * memory `megabytes` (`shadowWholeSceneCacheMb`) holds every atlas of every layer as 32-bit depth, a side down to the page, the atlases as many as the memory affords of that side (at least one).
 * The memory holds nothing while the static depths are not kept.
 */
export function atlasBudget(maxTextureSide: number, megabytes: number, cached: boolean) {
  const layers = atlasLayers(cached)
  const bytes = megabytes * 1048576
  const fits = cached ? Math.floor(Math.sqrt(bytes / (4 * layers))) : maxTextureSide
  const side =
    Math.max(Math.floor(Math.min(maxTextureSide, fits) / VSM_PAGE_TEXELS), 1) * VSM_PAGE_TEXELS
  return {
    side,
    pages: cached ? Math.max(Math.floor(bytes / (side * side * 4 * layers)), 1) : Infinity,
  }
}
