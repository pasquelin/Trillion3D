import type { PageSurface } from '../geometry/pages/surface.ts'
import type { Texture } from '../../../sdk-core/src/world/texture/texture.ts'
import type { HostMesh } from '../session/host/resources.ts'
import { isDrawnNode } from './host/graph/kinds.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

/** Meshes of a subtree, in preorder. Nothing is lifted here: the world matrices the
 *  engine needs are its own (`host/world/placements.ts`), and the host scene stays as it left it. */
export function meshes(node: Object3D) {
  const found: HostMesh[] = []
  node.traverse((object) => {
    if (isDrawnNode(object)) found.push(object)
  })
  return found
}
/** The textures a surface carries, whatever their slot: what its renderer samples. */
export function* materialTextures(material: PageSurface): Generator<Texture> {
  for (const value of Object.values(material))
    if ((value as { isTexture?: boolean } | null)?.isTexture) yield value as Texture
}
