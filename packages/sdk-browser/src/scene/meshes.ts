import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import type { HostGraphMaterial, HostGraphTexture } from '../host/scene/graphResources.ts'
import type { HostMesh } from '../host/resources.ts'
import { isDrawnNode } from '../host/graph/kinds.ts'
import { isGraphTexture } from '../host/graph/texture.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

/** Meshes of a subtree, in preorder. Nothing is lifted here: the world matrices the
 *  engine needs are its own (`../host/world/placements.ts`), and the host scene stays as it left it. */
export function meshes(node: Object3D) {
  const found: HostMesh[] = []
  node.traverse((object) => {
    if (isDrawnNode(object)) found.push(object)
  })
  return found
}
/** Reads the vertices of every geometry `meshes` wear, each once (`Geometry.loadVertices`): what a
 *  path awaits before it reads host vertices, which no session fetches up front. */
export const loadHostVertices = (meshes: Iterable<{ geometry: Geometry }>) =>
  Promise.all(
    Array.from(new Set(Array.from(meshes, (mesh) => mesh.geometry)), (geometry) =>
      geometry.loadVertices(),
    ),
  )
/** The textures a host material carries, whatever their slot: what its renderer would sample. */
export function* materialTextures(material: HostGraphMaterial): Generator<HostGraphTexture> {
  for (const value of Object.values(material)) if (isGraphTexture(value)) yield value
}
