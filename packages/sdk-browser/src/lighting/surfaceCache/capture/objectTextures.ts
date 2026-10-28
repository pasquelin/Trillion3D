import type { TileCounters } from '../../../materials/virtual/counters.ts'
import { forEachMaterialTexture } from '../../../materials/classes/materialTextures.ts'
import { layerSlot } from '../../../geometry/rows/page/pageRowMaterial.ts'
import type { PageSurface } from '../../../geometry/pages/surface.ts'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'

/** The slots the session gave the textures in its two atlases (`SessionVis.mapLayer`, `dataLayer`). */
interface TextureSlots {
  readonly mapLayer: ReadonlyMap<Texture, number>
  readonly dataLayer: ReadonlyMap<Texture, number>
}

/** The textures a surface wears and the atlas each is read through, made again only when the surface is written (its `version`). */
const worn = new WeakMap<
  object,
  { version: number; textures: { texture: Texture; kind: 'color' | 'data' }[] }
>()

function texturesOf(surface: PageSurface) {
  const held = worn.get(surface)
  if (held && held.version === surface.version) return held.textures
  const textures: { texture: Texture; kind: 'color' | 'data' }[] = []
  forEachMaterialTexture(surface, (texture, kind) => void textures.push({ texture, kind }))
  worn.set(surface, { version: surface.version, textures })
  return textures
}

/**
 * Whether a texture `surface` wears has its coarsest tile level pending (`TileCounters.missingCoarse`, the pump's own count told by texture): the
 * equivalent of a mesh with data pending in the reference (`StaticMeshHasPendingStreaming`), which is held back from
 * its cards till it is whole (the reference's mesh update, lines 845-870 of its card scene file). The cards read the coarse level; the finer
 * ones the view asks for refine it later and are no wait of theirs. Every texture the surface wears counts
 * (`forEachMaterialTexture`: its maps, those of its graph, its lobes and its height); a texture the atlas holds no slot of is not pending.
 */
export function texturesPending(
  counters: Pick<TileCounters, 'coarseMissing'>,
  slots: TextureSlots,
  surface: object | undefined,
) {
  if (!surface) return false
  // A root wears a page surface (`CardRoot.worn`, which names the part of it the placements read).
  const textures = texturesOf(surface as PageSurface)
  for (let i = 0; i < textures.length; i++) {
    const { texture, kind } = textures[i]
    const slot = layerSlot(kind === 'color' ? slots.mapLayer : slots.dataLayer, texture)
    if (slot > 0 && counters.coarseMissing(kind, slot)) return true
  }
  return false
}
