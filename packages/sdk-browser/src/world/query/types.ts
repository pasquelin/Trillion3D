import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'

/** Where a ray meets what the world draws (`world.raycast`): the object hit, the world point and the
 *  surface's normal there, how far along the ray, and which drawn triangle. */
export interface Intersection {
  /** The object hit: the very node the page added. */
  object: Object3D
  /** The world point hit. */
  point: Vector3
  /** The world normal of the face hit, as its winding orients it. */
  normal: Vector3
  /** Distance from the ray's origin to `point`, world units. */
  distance: number
  /** The drawn triangle hit: its cluster, times 256, plus its rank in the cluster — the triangle the
   *  image shows, at the finest detail the engine holds, stable while that cluster stays resident. */
  face: number
}

/** The objects a ray may meet: those under `objects` alone when given, never those under `skip`. */
export type RayFilter = {
  objects?: readonly Object3D[]
  skip?: readonly Object3D[]
}
