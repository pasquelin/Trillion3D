import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * WHETHER A PIXEL'S SURFACE HAS A DISTANCE FIELD: the mark the screen probes read to know that a ray
 * leaving the depth buffer behind a surface will find the surface in the distance field to resume
 * (`../../../../sdk-core/src/lighting/distanceFieldFile.ts`). A mesh has one when it casts a dynamic
 * shadow, affects the distance-field lighting and has a field in `distanceFields.bin`; its pixels
 * carry this flag in the surface-buffer flags the shade pass writes, beside the others
 * (`../../materials/surface/surfaceModel.ts`: the low three bits are the model, 16, 32, 64 and 128
 * are marks of their own; 8 is this one).
 */
export const DISTANCE_FIELD_REPRESENTATION_FLAG = 8

/** Whether a surface of surface-buffer flags `flags` has a distance field. */
const hasDistanceFieldRepresentation = wgslFn(
  'hasDistanceFieldRepresentation',
  [],
  `fn hasDistanceFieldRepresentation(flags:u32)->bool{return (flags&${DISTANCE_FIELD_REPRESENTATION_FLAG}u)!=0u;}`,
)

/**
 * The scale of the thickness the screen trace gives the depth buffer's surfaces at a pixel: 1 where
 * the surface has a distance field to resume the ray, `noFallbackScale` where it has none, so that a
 * ray the screen alone must settle treats the surfaces as thicker.
 */
export const screenTraceDepthThresholdScale = wgslFn(
  'screenTraceDepthThresholdScale',
  [hasDistanceFieldRepresentation],
  `fn screenTraceDepthThresholdScale(flags:u32,noFallbackScale:f32)->f32{return select(noFallbackScale,1.0,hasDistanceFieldRepresentation(flags));}`,
)
