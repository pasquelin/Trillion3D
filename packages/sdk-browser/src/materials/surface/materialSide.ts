import type { Side } from '../../../../sdk-core/src/contracts/material.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import type { PageMaterials } from '../../geometry/pages/pageMesh.ts'

/** The side a mesh's surface declares, the first of an array deciding; an empty array declares
 *  nothing and is drawn front only. */
export const sideOf = (material: PageMaterials): Side => surfaceOf(material).side
