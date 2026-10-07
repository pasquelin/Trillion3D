/**
 * THE IMPOSTOR ATLAS, streamed like any texture (fact 3). Each level of an atlas map
 * carries its own direct address (`maps.<name>.levels[k].url`, `docs/FORMAT.md` "Impostor
 * atlases"); the card reads those levels through the engine's ONE held-level read
 * (`readHeldLevel`, `texture/heldLevels.ts`), the one tiles are cut through: the level reader's own
 * store holds them within its room, under the same key, a read in flight is never doubled and a
 * failure is reported, never swallowed. There is no second loader and no second budget.
 */
import { PREVIEW_LOSSLESS_FORMAT, type ImpostorMaps } from '../../../sdk-core/src/index.ts'
import type { TextureLevel, TextureLevelRequest } from '../texture/levelReader.ts'
import type { HeldLevels } from '../texture/heldLevels.ts'
import { core } from './borrowed.ts'

/** The three maps of one card, each its levels, level 0 first. */
export type ImpostorAtlasLevels = Record<keyof ImpostorMaps, TextureLevel[]>

const MAP_NAMES = ['colourCoverage', 'normalDepth', 'orm'] as const

/**
 * The three maps of a card as the store holds them, every level of each: the atlas once all are
 * held, else `waiting` while their reads are asked together — or `refused` when one cannot fit
 * beside what the store keeps, nothing coming until room comes back. Each level is keyed as a
 * tile's is (its fingerprint, atlas 0, its level, the lossless format) and read at its own url.
 */
export function loadImpostorAtlas(
  maps: ImpostorMaps,
  levels: HeldLevels,
  frame: number,
): ImpostorAtlasLevels | 'waiting' | 'refused' {
  let verdict: 'waiting' | 'refused' | undefined
  const atlas = {} as ImpostorAtlasLevels
  for (const name of MAP_NAMES) {
    const chain: TextureLevel[] = (atlas[name] = [])
    maps[name].levels.forEach(({ sha256, url, width, height }, level) => {
      const request: TextureLevelRequest = {
        sha256,
        atlas: 0,
        level,
        format: PREVIEW_LOSSLESS_FORMAT,
        url,
      }
      const held = core.readHeldLevel(levels, request, frame, [width, height])
      if (typeof held !== 'string') chain.push(held)
      else if (verdict !== 'refused') verdict = held
    })
  }
  return verdict ?? atlas
}
