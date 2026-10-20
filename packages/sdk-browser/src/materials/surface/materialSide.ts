import type { Side } from '../../../../sdk-core/src/contracts/material.ts'
import type { HostMaterials } from '../../session/host/resources.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'

/** The side a mesh's surface declares, the first of an array deciding; an empty array declares
 *  nothing and is drawn front only. */
export const sideOf = (material: HostMaterials): Side => surfaceOf(material).side
