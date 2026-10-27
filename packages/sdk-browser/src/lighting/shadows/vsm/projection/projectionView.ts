// The projection's view uniform, one description: its WGSL structs, the words its writer fills and
// its byte size all derive from the field tables below (`fieldLayout`; `projectionPass.ts` writes,
// `projectionWgsl.ts` and `../trace/traceWgsl.ts` declare).

import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { arrayOf, fieldLayout } from '../../../../gpu/core/fieldLayout.ts'

/** The rays and steps of a view's traces (`VsmProjectionView.traceRays`): its shadow settings'. */
export type VsmTraceCounts = Pick<
  ShadowValues,
  | 'shadowRayCountDirectional'
  | 'shadowRayCountLocal'
  | 'shadowSamplesPerRayDirectional'
  | 'shadowSamplesPerRayLocal'
>

/** The records of the view uniform: the frame's shadowed lights, a uniform of 48 bytes a light kept
 *  under the 64 KiB a device binds (`assignChannels`). */
export const VSM_PROJECTION_MAX_PASS_LIGHTS = 1024

/** The suns at the head of a frame's lights (`VsmProjectionFrame.lights`: the suns first), at most `limit` of them: the one count the
 *  view's header, the projection and the per-light path read. */
export function sunCount(lights: ArrayLike<{ readonly type: string }>, limit = lights.length) {
  let suns = 0
  while (suns < limit && lights[suns].type === 'directional') suns++
  return suns
}

/** A light of the pass (`firstPersonMapId`: the first map of its sun's first-person clipmap, −1 for none): `radius` and `cosCone` are the lighting's range and cone
 *  (`localLightReaches`, −2 for any light but a spot), `direction` points towards the light. */
const LIGHT = fieldLayout('VsmProjectionLight', [
  ['shiftedPosition', 'vec3f'],
  ['radius', 'f32'],
  ['direction', 'vec3f'],
  ['sourceRadius', 'f32'],
  ['cosCone', 'f32'],
  ['mapId', 'i32'],
  ['kind', 'u32'],
  ['firstPersonMapId', 'i32'],
] as const)

/** The view (view space +Z forward, reverse-Z, matrices column-major as the engine's) before its
 *  lights; \`lightCount\` the records, the suns' first (\`sunCount\` of them). `originShiftHigh`/`Low` are the camera shift split into two floats; `traceRays` the rays
 *  a trace takes and the steps of each, a sun's then a local light's (`shadowRayCountDirectional`,
 *  `shadowRayCountLocal`, `shadowSamplesPerRayDirectional`, `shadowSamplesPerRayLocal`). */
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
  ['sunCount', 'u32'],
  ['depthFromDeviceZ', 'vec4f'],
  ['screenRayScale', 'vec4f'],
  ['inverseHalfFovTangent', 'f32'],
  ['viewPixels', 'vec4f'],
  ['projectionRect', 'vec4i'],
  ['traceRays', 'vec4u'],
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
