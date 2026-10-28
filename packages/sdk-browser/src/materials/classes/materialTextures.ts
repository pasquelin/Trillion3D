import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import type { BlendCopy } from '../../geometry/cluster/blendCopyContract.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import type { PageRec } from '../../geometry/selection/types.ts'
import {
  PHYSICAL_COLOUR_MAP_FIELDS,
  PHYSICAL_MAP_FIELDS,
  SURFACE_MAP_FIELDS,
} from '../../visibility/materialType.ts'
import { hasPhysicalLobes } from '../surface/physicalLobes.ts'

/** Store a texture in an atlas if it is not already there, and return the slot it occupies.
 *  Slot 0 is the fill texel, so the first stored texture takes slot 1. */
const adder = (known: Map<Texture, number>, list: Texture[]) => (texture?: Texture) => {
  if (!texture) return
  if (known.has(texture)) return
  known.set(texture, list.length + 1)
  list.push(texture)
}

/** The surface maps read through the colour atlas; the others of a surface are data (`writeMaterialRecord`). */
const SURFACE_COLOUR_MAPS: ReadonlySet<string> = new Set(['map', 'emissiveMap', 'subsurfaceMap'])

/** The atlas a texture of a surface is read through. */
type MaterialTextureKind = 'color' | 'data'

/**
 * THE TEXTURES A SURFACE WEARS, each with the atlas it is read through, in a stable order: the surface's own maps (`SURFACE_MAP_FIELDS`),
 * the textures a graph reads (through the colour atlas, `../graph/nodesTexture.ts`), the anisotropic, clear-coat and cloth maps of a surface
 * that carries a lobe (`physicalWgsl.ts`; the sheen colour is a colour), and the height map of a displaced surface
 * (`../../visibility/tessellation/`). The one list of them: the census of the atlases' slots and the cache's wait for textures both read it.
 * `visit` returning true stops the walk, which then returns true.
 */
export function forEachMaterialTexture(
  mat: PageSurface,
  visit: (texture: Texture, kind: MaterialTextureKind) => boolean | void,
): boolean {
  const stops = (texture: Texture | undefined, kind: MaterialTextureKind) =>
    !!texture && visit(texture, kind) === true
  for (const field of SURFACE_MAP_FIELDS)
    if (stops(mat[field], SURFACE_COLOUR_MAPS.has(field) ? 'color' : 'data')) return true
  for (const texture of mat.graph?.readTextures() ?? []) if (stops(texture, 'color')) return true
  if (hasPhysicalLobes(mat))
    for (const field of PHYSICAL_MAP_FIELDS)
      if (stops(mat[field], PHYSICAL_COLOUR_MAP_FIELDS.has(field) ? 'color' : 'data')) return true
  return !!mat.displacement && stops(mat.displacementMap, 'data')
}

/**
 * Census every colour and data texture once, in a stable slot order.
 */
export function collectWebgpuMaterialTextures(
  allPages: PageRec[],
  blendCopies: readonly BlendCopy[],
  mapLayer: Map<Texture, number>,
  dataLayer: Map<Texture, number>,
) {
  const maps: Texture[] = []
  const dataMaps: Texture[] = []
  const addColor = adder(mapLayer, maps)
  const addData = adder(dataLayer, dataMaps)
  const visited = new Set<PageSurface>()
  const collect = (mat: PageSurface) => {
    if (visited.has(mat)) return
    visited.add(mat)
    forEachMaterialTexture(
      mat,
      (texture, kind) => void (kind === 'color' ? addColor : addData)(texture),
    )
  }
  for (const rec of allPages) collect(rec.material)
  for (const copy of blendCopies) collect(copy.surface)
  return { maps, dataMaps }
}
