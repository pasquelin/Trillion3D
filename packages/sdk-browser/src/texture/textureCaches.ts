import type { Texture } from '../../../sdk-core/src/texture/contract.ts'
import type { TexturePreview } from '../../../sdk-core/src/texture/previewContracts.ts'
import { previewAtlasOf } from '../../../sdk-core/src/texture/previewFormat.ts'
import type { ClusterManifest } from '../../../sdk-core/src/contracts/geometry.ts'
import type { PageCache } from '../streaming/pageCache.ts'
import {
  createTextureLevelReader,
  type TextureLevelReader,
  type TextureLevelStore,
} from './levelReader.ts'

/** A compiled cache whose textures a session draws: the glTF rank of each texture its scene built,
 *  its manifest — the sidecar entries, the address of its levels, its cook — and the folder its
 *  files are read against. */
export type TextureCache = {
  ranks: ReadonlyMap<Texture, number>
  metadata: Pick<ClusterManifest, 'textures' | 'key' | 'texturePreviews'>
  base: string
}

/** A texture's baked chain for one atlas, and the reader of its cache's levels: none for a cache
 *  that files no level. */
export type BakedChain = { preview: TexturePreview; read: TextureLevelReader | undefined }

/**
 * Sidecar entries filed by the scene texture they cover and the atlas that samples them: the same
 * texture can have an entry for each, reduced by that atlas's curve. A coverage chain is its
 * texture's colour-atlas entry — that texture then has no plain one — and keeps its own word,
 * which names its files.
 */
export function previewsByAtlas(previews: readonly TexturePreview[]) {
  const filed = new Map<string, TexturePreview>()
  for (const preview of previews)
    filed.set(`${preview.texture}/${previewAtlasOf(preview.atlas)}`, preview)
  return (texture: number, atlas: number) => filed.get(`${texture}/${atlas}`)
}

/**
 * THE CACHES A SESSION'S TEXTURES COME FROM: the session's own, then each model a world draws with
 * it — at open, or joining later. A texture's chain is the one the cache whose scene built it
 * baked, its levels read from that cache's folder, under that cache's cook, held in the session's
 * one page cache (`cache`) within its one budget. The reader exists as soon as a cache declares
 * texture chains: the engine reads the levels the compiler baked, and regenerates none it could
 * have read instead. A cache added twice is one.
 */
export function createTextureCaches(
  cache: Pick<PageCache, 'readRange'> & TextureLevelStore,
  signal?: AbortSignal,
) {
  const cooks: {
    ranks: TextureCache['ranks']
    chainAt: ReturnType<typeof previewsByAtlas>
    read: TextureLevelReader | undefined
  }[] = []
  const previews: TexturePreview[] = []
  return {
    /** Every cache's sidecar entries: what the session's block family is chosen from. */
    previews: previews as readonly TexturePreview[],
    /** The textures of `caches` read their chains from them; a cache held already is skipped. */
    add(...caches: readonly TextureCache[]) {
      for (const added of caches) {
        if (cooks.some((cook) => cook.ranks === added.ranks)) continue
        const entries = added.metadata.texturePreviews ?? []
        previews.push(...entries)
        cooks.push({
          ranks: added.ranks,
          chainAt: previewsByAtlas(entries),
          read: createTextureLevelReader(added.metadata, added.base, cache, signal),
        })
      }
    },
    /** The chain `texture` has in `atlas`, in the cache whose scene built it; none for a texture
     *  no cache ranks, or one its cache baked no chain of. */
    chainOf(texture: Texture, atlas: number): BakedChain | undefined {
      for (const cook of cooks) {
        const rank = cook.ranks.get(texture)
        if (rank === undefined) continue
        const preview = cook.chainAt(rank, atlas)
        return preview && { preview, read: cook.read }
      }
      return undefined
    },
  }
}

export type TextureCaches = ReturnType<typeof createTextureCaches>
