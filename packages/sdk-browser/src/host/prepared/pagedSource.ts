import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'

/** The source geometry each host mesh of the autonomous document was paged from: that document
 *  draws a one-triangle stand-in, the pages hold the source primitive's triangles. */
const sources = new WeakMap<object, () => Geometry>()
export const registerPagedSource = (mesh: object, of: () => Geometry) => sources.set(mesh, of)

/** The geometry `mesh`'s pages were cut from, its vertices read on their first load: the source
 *  primitive's for a stand-in, its own otherwise. */
export const pagedGeometry = (mesh: { geometry: Geometry }) =>
  sources.get(mesh)?.() ?? mesh.geometry
