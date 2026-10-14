import { wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { invTranspose3Prep } from '../../../../math/src/wgsl/inverseTranspose.ts'

const PlacedRay = wgslStruct(
  'PlacedRay',
  [],
  'struct PlacedRay{origin:vec3f,direction:vec3f,regular:bool,}',
)

/**
 * THE ONE RAY TAKEN INTO A PLACEMENT'S SPACE, for every ray that walks the placement tree
 * (`treeWalkWgsl.ts`): the run-time proxy's (`../../bounce/runtimeSceneWgsl.ts`) and the ray query's
 * (`../../webgpu/rays/rayPlacementWgsl.ts`). `linear` is the world's linear part, `offset` the ray's
 * origin less the world's translation — each caller makes it at its own precision —, `direction`
 * the ray's. The ray is taken there by the inverse of the linear part: a row vector times the
 * engine's inverse-transpose (`invTranspose3Prep`). A singular world (`regular` false) holds no
 * volume a ray can enter.
 */
export const placementRay = wgslFn(
  'placementRay',
  [PlacedRay, invTranspose3Prep],
  `fn placementRay(linear:mat3x3f,offset:vec3f,direction:vec3f)->PlacedRay{
 let back=invTranspose3Prep(linear);
 return PlacedRay(offset*back.adj*back.scale,direction*back.adj*back.scale,back.regular);
}`,
)
