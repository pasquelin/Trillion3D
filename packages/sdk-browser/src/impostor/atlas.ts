/**
 * THE IMPOSTOR ATLAS, streamed like any texture (fact 3). Each level of an atlas map
 * carries its own direct address (`maps.<name>.levels[k].url`, `docs/FORMAT.md` "Impostor
 * atlases"); the card reads those levels through the engine's ONE held-level read, the one tiles
 * are cut through (`texture/heldLevels.ts`): held in the page cache within its one budget, under
 * the same cook, a read in flight never doubled and a failure reported, never swallowed. There is
 * no second loader and no second budget.
 */
import { PREVIEW_LOSSLESS_FORMAT, type ImpostorMaps } from '../../../sdk-core/src/index.ts'
import type { TextureLevelAddress } from '../texture/levelReader.ts'
import type { HeldLevels, LevelFailed } from '../texture/heldLevels.ts'

/** The three maps of one card, each its levels, level 0 first: lossless levels, which the browser
 *  decodes. */
export type ImpostorAtlasLevels = Record<keyof ImpostorMaps, ImageBitmap[]>

const MAP_NAMES = ['colourCoverage', 'normalDepth', 'orm'] as const

/**
 * The three maps of a card as the page cache holds them, every level of each: the atlas once all
 * are held, else `waiting` while their reads are asked together — or `refused` when one cannot fit
 * beside what the cache keeps, nothing coming until room comes back. Each level is keyed as a
 * tile's is (its fingerprint, atlas 0, its level) and read at its own url in the lossless format:
 * the request asks a decoded image, so a level held is one.
 */
export function loadImpostorAtlas(
  maps: ImpostorMaps,
  levels: HeldLevels,
  failed: LevelFailed,
): ImpostorAtlasLevels | 'waiting' | 'refused' {
  let verdict: 'waiting' | 'refused' | undefined
  const atlas = {} as ImpostorAtlasLevels
  for (const name of MAP_NAMES) {
    const chain: ImageBitmap[] = (atlas[name] = [])
    maps[name].levels.forEach(({ sha256, url, width, height }, level) => {
      const address: TextureLevelAddress = {
        sha256,
        atlas: 0,
        level,
        format: PREVIEW_LOSSLESS_FORMAT,
        url,
      }
      const held = levels.read(address, [width, height], failed)
      if (typeof held !== 'string') chain.push(held as ImageBitmap)
      else if (verdict !== 'refused') verdict = held
    })
  }
  return verdict ?? atlas
}
