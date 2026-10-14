/**
 * The textures of the prepared scene, built from the texture table and the images the scene
 * tables locate, under the rules the host loader applied — since the scene the engine draws is
 * proven by being the same scene:
 *
 * - one texture per image AND sampler rank: two table ranks naming both alike share it, and
 *   the rank it answers to is the first of them (the preview the sidecar bakes is found by it);
 * - one image decoded per image rank: a second texture of the same image is a copy sharing it;
 * - a slot reading another coordinate set, or declaring a transform, is a copy of its texture —
 *   the transform composed from what the slot declares — and only a copy on the
 *   first coordinate set keeps the texture's rank;
 * - colour maps are sRGB, the rest linear; rows are not flipped;
 * - each is the engine's texture record itself (`Texture`), its transform composed as it is placed.
 */
import type { TableTextureSlot } from '../../../../sdk-core/src/index.ts'
import { TABLE_FILTERS } from '../../../../sdk-core/src/scene/core/tableSurfaces.ts'
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'

/**
 * The textures of `tables` for the images of `document`: `slot` resolves a material's map slot
 * to its texture record, or `null` when its image could not be read.
 */
export function preparedTextures(
  tables: PreparedSceneTables,
  document: TableDocument,
  images: (rank: number) => Promise<unknown>,
  /** The rank each built texture answers to, keyed by the texture: what the engine finds the
   *  baked preview of a texture by (`textureIndices`). */
  ranks: Map<Texture, number>,
) {
  const sources = new Map<number, Promise<Texture | null>>()
  const folded = new Map<string, Promise<Texture | null>>()

  /** The texture holding image `rank`: the first request owns it, later ones copy it. */
  const source = (rank: number) => {
    const held = sources.get(rank)
    if (held) return held.then((texture) => texture?.clone() ?? null)
    const made = images(rank).then((image) => {
      if (image === null) return null
      const texture = new Texture(image)
      texture.colorSpace = 'linear'
      return texture
    })
    sources.set(rank, made)
    return made
  }

  const textureOf = (rank: number) => {
    const declared = tables.textures[rank]
    const image = declared?.image == null ? undefined : document.images[declared.image]
    if (!image) return Promise.resolve(null)
    const key = `${image.uri || image.view}:${declared.sampler ?? undefined}`
    let texture = folded.get(key)
    if (!texture) {
      texture = source(declared.image!).then((built) => {
        if (!built) return null
        built.flipY = false
        built.name = declared.name || image.name || ''
        if (!built.name && image.uri !== null && !image.uri.startsWith('data:image/'))
          built.name = image.uri
        built.magFilter = TABLE_FILTERS[declared.magFilter]
        built.minFilter = TABLE_FILTERS[declared.minFilter]
        built.wrapS = declared.wrapS
        built.wrapT = declared.wrapT
        ranks.set(built, rank)
        return built
      })
      folded.set(key, texture)
    }
    return texture
  }

  return async (slot: TableTextureSlot, colour: boolean) => {
    let texture = await textureOf(slot.texture)
    if (!texture) return null
    const { transform, texCoord, slotTexCoord } = slot
    const moved =
      !!transform && (!!transform.offset || transform.rotation !== null || !!transform.scale)
    // The loader's two steps: a slot naming another set than the first reads a copy of the
    // texture; a transform that moves the coordinates, or names another set again, a copy of that.
    if (slotTexCoord > 0 || moved || texCoord !== slotTexCoord) {
      const rank = ranks.get(texture)
      texture = texture.clone()
      texture.channel = texCoord
      if (transform?.offset) texture.offset.set(transform.offset[0], transform.offset[1])
      if (transform && transform.rotation !== null) texture.rotation = transform.rotation
      if (transform?.scale) texture.repeat.set(transform.scale[0], transform.scale[1])
      // A copy made for the slot's own set answers to no rank, as the loader published none for
      // it; a copy the transform alone made keeps its texture's, whatever set it then reads.
      if (rank !== undefined && slotTexCoord === 0) ranks.set(texture, rank)
    }
    if (colour) texture.colorSpace = 'srgb'
    return texture
  }
}
