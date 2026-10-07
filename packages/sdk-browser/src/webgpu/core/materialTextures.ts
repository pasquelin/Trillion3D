import type { Texture } from '../../../../sdk-core/src/index.ts'
import type { BlendCopy } from '../../cluster/blendCopyContract.ts'
import type { PageSurface } from '../../page/surface.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import { CoverageReaders } from '../../texture/coverage.ts'
import { PHYSICAL_MAP_FIELDS } from '../../visibility/materialType.ts'
import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'

/** Store a texture in an atlas if it is not already there, and return the slot it occupies.
 *  Slot 0 is the fill texel, so the first stored texture takes slot 1. */
const adder = (known: Map<Texture, number>, list: Texture[]) => (texture?: Texture) => {
  if (!texture) return
  if (known.has(texture)) return
  known.set(texture, list.length + 1)
  list.push(texture)
}

/**
 * Census every colour and data texture once, in a stable slot order, and the readers of each
 * colour texture, which say whether its mips weigh by alpha (`CoverageReaders`).
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
  const coverage = new CoverageReaders()
  const collect = (mat: PageSurface) => {
    if (!coverage.read(mat)) return
    addColor(mat.map)
    addColor(mat.emissiveMap)
    addColor(mat.subsurfaceMap)
    addData(mat.roughnessMap)
    addData(mat.metalnessMap)
    addData(mat.normalMap)
    addData(mat.aoMap)
    // The anisotropic and clear-coat maps of a surface that carries a lobe (`physicalWgsl.ts`).
    if (hasPhysicalLobes(mat)) for (const field of PHYSICAL_MAP_FIELDS) addData(mat[field])
  }
  for (const rec of allPages) collect(rec.material)
  for (const copy of blendCopies) collect(copy.surface)
  return { maps, dataMaps, coverage }
}
