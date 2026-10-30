import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { SAMPLED_TILE_MODES, SAMPLED_TILE_SIZE } from './parameters.ts'

/** The threads along an edge of a group of every kernel of the sampled lighting. */
export const SAMPLED_GROUP = 8

/** Words of one visible light set of a tile of the hash, of one hidden set, and so of the pair a tile holds. */
export const VISIBLE_HASH_WORDS = 4
export const HIDDEN_HASH_WORDS = 2
const TILE_HASH_WORDS = VISIBLE_HASH_WORDS + HIDDEN_HASH_WORDS

/** The words of one dispatch's arguments: three groups counts. */
const DISPATCH_ARGS_WORDS = 3

/** The sizes of an image of the sampled lighting: the view, the tiles of the classification, the downsampled view and its tiles, and
 *  the samples. */
export interface SampledGeometry {
  readonly view: readonly [number, number]
  /** The tiles of the view, and of the downsampled view. */
  readonly tiles: readonly [number, number]
  readonly downsample: readonly [number, number]
  readonly downsampledView: readonly [number, number]
  readonly downsampledTiles: readonly [number, number]
  readonly samplesPerPixel: readonly [number, number]
  /** The texels of the samples' textures: the downsampled view times the samples of a pixel. */
  readonly sampleView: readonly [number, number]
  /** The words a mode's list of tiles holds: the most tiles either grid has. */
  readonly tileListStride: number
}

/** The geometry of an image of `width` × `height` pixels downsampled by `downsample`, `samples` to a downsampled pixel. */
export function sampledGeometry(
  width: number,
  height: number,
  downsample: readonly [number, number],
  samples: readonly [number, number],
): SampledGeometry {
  const tiles = [ceilDiv(width, SAMPLED_TILE_SIZE), ceilDiv(height, SAMPLED_TILE_SIZE)] as const
  const downsampledView = [ceilDiv(width, downsample[0]), ceilDiv(height, downsample[1])] as const
  const downsampledTiles = [
    ceilDiv(downsampledView[0], SAMPLED_TILE_SIZE),
    ceilDiv(downsampledView[1], SAMPLED_TILE_SIZE),
  ] as const
  return {
    view: [width, height],
    tiles,
    downsample,
    downsampledView,
    downsampledTiles,
    samplesPerPixel: samples,
    sampleView: [downsampledView[0] * samples[0], downsampledView[1] * samples[1]],
    tileListStride: Math.max(tiles[0] * tiles[1], downsampledTiles[0] * downsampledTiles[1]),
  }
}

/** The samples of a downsampled pixel, in all. */
export const samplesOfPixel = (g: SampledGeometry) => g.samplesPerPixel[0] * g.samplesPerPixel[1]

/** The tiles of the hash: one per tile of the view, whatever the downsample, as the hash tile is eight pixels of the view. */
const hashTileCount = (g: SampledGeometry) => g.tiles[0] * g.tiles[1]

/** The words the guide buffer of an image holds: every tile's visible set then its hidden set (the hash of the lights seen and
 *  not seen), then the ratio of each light's power to its power last image (`lights` of them), then the rank each light had in the image before plus one (`lights` more). */
export const guideWords = (g: SampledGeometry, lights: number) =>
  hashTileCount(g) * TILE_HASH_WORDS + 2 * lights

/** Where the visible sets, the hidden sets and the ratios start in the guide buffer, in words. */
export const guideAt = (g: SampledGeometry) => ({
  visible: 0,
  hidden: hashTileCount(g) * VISIBLE_HASH_WORDS,
  ratios: hashTileCount(g) * TILE_HASH_WORDS,
})

/** Where the ranks the lights had in the image before start in the guide buffer, in words: right after the `lights` ratios. */
export const ranksAt = (g: SampledGeometry, lights: number) => guideAt(g).ratios + lights

/** The words of the tile lists (a list a mode, the tiles of the grid in each) and the bytes of the arguments of the indirect dispatches. */
export const tileListWords = (g: SampledGeometry) => SAMPLED_TILE_MODES * g.tileListStride
export const tileArgsBytes = () => SAMPLED_TILE_MODES * DISPATCH_ARGS_WORDS * 4
/** Where the arguments of the dispatch over `mode`'s tiles start, in bytes. */
export const tileArgsAt = (mode: number) => mode * DISPATCH_ARGS_WORDS * 4
