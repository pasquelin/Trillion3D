import type { DrawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts'

/** The geometry of drawn triangles, under the attribute names a mesh reads. A sprite's quad is
 *  bounded as its pages are (`runtimePrimitive.ts`): by the cube and ball of its radius about its
 *  origin, which hold it whichever way the rasters turn it. */
export function hostGeometry(drawn: DrawnTriangles) {
  const geometry = new Geometry()
  geometry.setAttribute('position', new BufferAttribute(drawn.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(drawn.normals, 3))
  if (drawn.uvs) geometry.setAttribute('uv', new BufferAttribute(drawn.uvs, 2))
  if (drawn.colors) geometry.setAttribute('color', new BufferAttribute(drawn.colors, 4))
  const deformation = drawn.deformation
  if (deformation?.joints && deformation.weights) {
    geometry.setAttribute(
      'skinIndex',
      new BufferAttribute(deformation.joints, deformation.influences ?? 4),
    )
    geometry.setAttribute(
      'skinWeight',
      new BufferAttribute(deformation.weights, deformation.influences ?? 4),
    )
  }
  geometry.morphTargetsRelative = true
  geometry.morphAttributes.position =
    deformation?.targets.map((t) => new BufferAttribute(t.positions, 3)) ?? []
  geometry.morphAttributes.normal =
    deformation?.targets.map((t) => new BufferAttribute(t.normals, 3)) ?? []
  geometry.setIndex(new BufferAttribute(drawn.indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const radius = drawn.spriteRadius
  if (radius !== undefined) {
    geometry.boundingBox!.min.set(-radius, -radius, -radius)
    geometry.boundingBox!.max.set(radius, radius, radius)
    geometry.boundingSphere!.center.set(0, 0, 0)
    geometry.boundingSphere!.radius = radius
  }
  return geometry
}
