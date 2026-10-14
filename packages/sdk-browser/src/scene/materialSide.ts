import type { Side } from '../../../sdk-core/src/index.ts'
import type { HostMaterials } from '../host/resources.ts'
import { surfaceOf } from '../page/surface.ts'

/** The material that decides for a mesh: the one declared, or the first of an array — an
 *  empty array declaring nothing (`undefined`). */
export const firstMaterial = <M>(material: M | M[]): M | undefined =>
  Array.isArray(material) ? material[0] : material

/** The side a mesh's surface declares, the first of an array deciding; an empty array declares
 *  nothing and is drawn front only. */
export const sideOf = (material: HostMaterials): Side => surfaceOf(material).side
