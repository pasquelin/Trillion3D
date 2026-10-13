// The projection's view uniform, one description: its WGSL structs, the words its writer fills and
// its byte size all derive from the field tables below (`fieldLayout`; `projectionPass.ts` writes,
// `projectionWgsl.ts` and `traceWgsl.ts` declare).

import { arrayOf, fieldLayout } from '../gpu/core/fieldLayout.ts'

/** Lights per dispatch: the frame's shadowed lights (`assignSlice`'s 64 channels). */
export const VSM_PROJECTION_MAX_PASS_LIGHTS = 64

/** A light of the pass: `radius` and `cosCone` are the lighting's range and cone
 *  (`localLightReaches`, −2 for any light but a spot), `direction` points towards the light. */
const LIGHT = fieldLayout('VsmProjectionLight', [
  ['shiftedPosition', 'vec3f'],
  ['radius', 'f32'],
  ['direction', 'vec3f'],
  ['sourceRadius', 'f32'],
  ['cosCone', 'f32'],
  ['mapId', 'i32'],
  ['kind', 'u32'],
] as const)

/** The view (view space +Z forward, reverse-Z, matrices column-major as the engine's) before its
 *  lights. `originShiftHigh`/`Low` are the camera shift split into two floats. */
const VIEW = fieldLayout('VsmProjectionView', [
  ['shiftedToClip', 'mat4x4f'],
  ['shiftedToView', 'mat4x4f'],
  ['viewToClip', 'mat4x4f'],
  ['clipToShifted', 'mat4x4f'],
  ['originShiftHigh', 'vec3f'],
  ['frameIndex', 'u32'],
  ['originShiftLow', 'vec3f'],
  ['isOrtho', 'u32'],
  ['shiftedEye', 'vec3f'],
  ['lightCount', 'u32'],
  ['viewForward', 'vec3f'],
  ['depthFromDeviceZ', 'vec4f'],
  ['screenRayScale', 'vec4f'],
  ['halfFovTangents', 'vec4f'],
  ['viewPixels', 'vec4f'],
  ['screenSlab', 'vec4f'],
  ['projectionRect', 'vec4i'],
  ['lights', arrayOf(LIGHT, VSM_PROJECTION_MAX_PASS_LIGHTS)],
] as const)

/** Words of the header (the view up to its lights) and of a light's record. */
export const VSM_PROJECTION_HEADER_WORDS = VIEW.at.lights
export const VSM_PROJECTION_LIGHT_WORDS = LIGHT.words
/** Byte size of `VsmProjectionView` (uniform). */
export const VSM_PROJECTION_VIEW_BYTES = 4 * VIEW.words

/** The word of each header field, and of each light field in its record. */
export const VSM_PROJECTION_VIEW_WORD = VIEW.at
export const VSM_PROJECTION_LIGHT_WORD = LIGHT.at

/** `VsmProjectionLight`, as the traces and the region test read it. */
export const VSM_PROJECTION_LIGHT_STRUCT = LIGHT.wgsl
/** `VsmProjectionView`, its lights after the header. */
export const VSM_PROJECTION_VIEW_STRUCT = VIEW.wgsl
