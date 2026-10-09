/**
 * THE IMPOSTOR ATLAS, streamed like any texture (fact 3). Each level of an atlas map
 * carries its own direct address (`maps.<name>.levels[k].url`, `docs/FORMAT.md` "Impostor
 * atlases"); the card reads those levels through the engine's ONE held-level read, the one tiles
 * are cut through (`texture/heldLevels.ts`): held in the page cache within its one budget, under
 * the same cook, a read in flight never doubled and a failure reported, never swallowed. There is
 * no second loader and no second budget.
 */
import { PREVIEW_LOSSLESS_FORMAT, type ImpostorMaps } from '../../../sdk-core/src/index.ts'
import type { HeldLevels, LevelAsk, LevelFailed } from '../texture/heldLevels.ts'
import { core } from './borrowed.ts'

/** The three maps of one card, each its levels, level 0 first: lossless levels, which the browser
 *  decodes. */
export type ImpostorAtlasLevels = Record<keyof ImpostorMaps, ImageBitmap[]>

const MAP_NAMES = ['colourCoverage', 'normalDepth', 'orm'] as const

/** The asks of a card's levels, built once (`HeldLevels.ask`): each map's, level 0 first, and all
 *  of them in map order. */
export type ImpostorAtlasAsks = {
  readonly maps: Record<keyof ImpostorMaps, readonly LevelAsk[]>
  readonly all: readonly LevelAsk[]
}

/** Host bytes the levels of `maps` take once all are decoded. */
export const impostorAtlasBytes = (maps: ImpostorMaps) =>
  MAP_NAMES.reduce(
    (sum, name) =>
      maps[name].levels.reduce(
        (bytes, { width, height }) => bytes + core.bitmapBytes(width, height),
        sum,
      ),
    0,
  )

/** The asks of every level of `maps`. Each level is keyed as a tile's is (its fingerprint, atlas 0,
 *  its level) and read at its own url in the lossless format: the request asks a decoded image,
 *  so a level held is one. */
export function impostorAtlasAsks(maps: ImpostorMaps, levels: HeldLevels): ImpostorAtlasAsks {
  const asks = {} as Record<keyof ImpostorMaps, LevelAsk[]>
  for (const name of MAP_NAMES)
    asks[name] = maps[name].levels.map(({ sha256, url, width, height }, level) =>
      levels.ask({ sha256, atlas: 0, level, format: PREVIEW_LOSSLESS_FORMAT, url }, [
        width,
        height,
      ]),
    )
  return { maps: asks, all: MAP_NAMES.flatMap((name) => asks[name]) }
}

/**
 * The three maps of a card as the page cache holds them, every level of each: the atlas once all
 * are held, else `waiting` while their reads are asked together — `refused` when one cannot fit
 * beside what the cache keeps, nothing coming until room comes back; `failed` when one failed for
 * good, nothing ever coming.
 */
export function loadImpostorAtlas(
  asks: ImpostorAtlasAsks,
  levels: HeldLevels,
  failed: LevelFailed,
): ImpostorAtlasLevels | 'waiting' | 'refused' | 'failed' {
  let verdict: 'waiting' | 'refused' | undefined
  const atlas = {} as ImpostorAtlasLevels
  for (const name of MAP_NAMES) {
    const chain: ImageBitmap[] = (atlas[name] = [])
    for (const ask of asks.maps[name]) {
      const held = levels.readAsked(ask, failed)
      if (typeof held !== 'string') chain.push(held as ImageBitmap)
      else if (levels.failedForGood(ask)) return 'failed'
      else if (verdict !== 'refused') verdict = held
    }
  }
  return verdict ?? atlas
}
