import { isInstancedNode } from '../../host/graph/kinds.ts'
import { type Centre, placementsCentre } from './placementSpheres.ts'
/** A drawn mesh as its depth reads it: its own sphere or its geometry's, and its world matrix. */
type DepthNode = {
  readonly geometry?: unknown
  readonly matrixWorld: { elements: ArrayLike<number> }
}
type Bounded = {
  boundingSphere?: { center: Centre; radius?: number } | null
  computeBoundingSphere?(): void
}

/**
 * The depth a mesh is sorted by: the normalised-device z of its bounding
 * sphere's centre (clip z over clip w, so a point behind the camera sorts by the same number) — the mesh's own sphere where it has one, the union of its placements' spheres for an
 * instanced mesh, its geometry's otherwise — never its origin, which a mesh whose vertices carry
 * their pose sets at the scene's. `screen` is the projection times the view.
 */
export function depthOf(mesh: DepthNode, screen: ArrayLike<number>) {
  const own = (mesh as Bounded).boundingSphere
  let centre = own?.center
  if (own === undefined) {
    const geometry = mesh.geometry as Bounded | undefined
    if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere?.()
    const sphere = geometry?.boundingSphere
    centre = isInstancedNode(mesh) && sphere ? placementsCentre(mesh, sphere) : sphere?.center
  }
  const c = centre ?? ORIGIN,
    m = mesh.matrixWorld.elements
  const x = m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12],
    y = m[1] * c.x + m[5] * c.y + m[9] * c.z + m[13],
    z = m[2] * c.x + m[6] * c.y + m[10] * c.z + m[14],
    w = m[3] * c.x + m[7] * c.y + m[11] * c.z + m[15]
  const inverseW = 1 / (screen[3] * x + screen[7] * y + screen[11] * z + screen[15] * w)
  return (screen[2] * x + screen[6] * y + screen[10] * z + screen[14] * w) * inverseW
}
const ORIGIN: Centre = { x: 0, y: 0, z: 0 }
