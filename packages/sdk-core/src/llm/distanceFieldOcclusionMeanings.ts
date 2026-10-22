import type { DistanceFieldOcclusionField } from '../contracts/distanceFieldOcclusionOptions.ts'

/** What each setting of the sky light's distance-field occlusion means (`../contracts/distanceFieldOcclusionOptions.ts`). */
export const DISTANCE_FIELD_OCCLUSION_MEANINGS: Readonly<
  Record<DistanceFieldOcclusionField, string>
> = {
  distanceFieldOcclusion:
    'Whether the dynamic sky light is occluded by the distance fields, where it casts shadows and no screen probes light the pixels; true by default.',
  distanceFieldOcclusionQuality:
    "The method, 0 off, 1 the global distance field alone, 2 the meshes' own fields too; 2 by default.",
  distanceFieldOcclusionObjects:
    "Whether the meshes' own fields are traced for the first stretch of each cone, at quality 2; true by default.",
  distanceFieldOcclusionStepExponentScale:
    "The exponent that spaces the samples along a cone in the meshes' fields, at least 0; 0.5 by default.",
  distanceFieldOcclusionMaxViewDistance:
    'The farthest a pixel is lit by it, in centimetres, held to 65000; past it the sky is unoccluded. 20000 by default.',
  distanceFieldOcclusionViewFadeDistanceScale:
    'The share of the view distance past which the occlusion fades out, 0 to just under 1; 0.7 by default.',
  distanceFieldOcclusionSampleSet:
    'The cones directions, 0 the original ones, 1 the relaxed ones; 1 by default.',
  distanceFieldOcclusionJitterConeDirections:
    'Whether the cones are turned by a random angle each image; false by default.',
  distanceFieldOcclusionUseJitter:
    "Whether the cones' grid jitters over four images, for four times the samples once the history has them; true by default.",
  distanceFieldOcclusionTraverseMips:
    "Whether a cone through a mesh's field climbs to its coarser mips away from the surface; true by default.",
  distanceFieldOcclusionUseHistory:
    "Whether the last image's occlusion is blended in; true by default.",
  distanceFieldOcclusionHistoryStabilityPass:
    'Whether the values that dropped their history are filled from the stable ones round them, at quality 2; true by default.',
  distanceFieldOcclusionHistoryWeight:
    'The share of the last image the temporal filter keeps, at least 0; 0.85 by default.',
  distanceFieldOcclusionHistoryDistanceThreshold:
    "The distance in centimetres past which a history value is another surface's, at least 0; 30 by default.",
  distanceFieldOcclusionSpecularMode:
    "How the specular light is occluded, 0 by the bent normal's length, 1 by the intersection of the reflection cone with the unoccluded one; 1 by default.",
  skyLightSpecularOcclusionStrength:
    'The strength of the specular occlusion by that intersection, at least 0.1 where it is used; 1 by default.',
  distanceFieldOcclusionObjectsPerCullTile:
    'The room a screen tile has for the meshes that reach it, at least 1; 512 by default.',
}
