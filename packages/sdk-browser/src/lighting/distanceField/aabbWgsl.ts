import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/** The squared distance between two axis-aligned boxes, each its centre and half-extent: zero where
 *  they touch or overlap. */
export const squaredDistanceBetweenBoxes = wgslFn(
  'squaredDistanceBetweenBoxes',
  [],
  `fn squaredDistanceBetweenBoxes(centreA:vec3f,extentA:vec3f,centreB:vec3f,extentB:vec3f)->f32{
 let apart=max(abs(centreB-centreA)-(extentA+extentB),vec3f(0.0));
 return dot(apart,apart);
}`,
)
