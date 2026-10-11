// The projection's view uniform, one description: its WGSL structs, the words its writer fills and
// its byte size all derive from the field lists below (`projectionPass.ts` writes, `projectionWgsl.ts`
// and `traceWgsl.ts` declare). Scalars pack into the 16-byte row of the vector before them.

import { ceilDiv } from '../../../math/src/scalar/integers.ts'

/** Words of a WGSL type of the view's fields. */
const WORDS = { mat4x4f: 16, vec4f: 4, vec4i: 4, vec3f: 3, f32: 1, u32: 1, i32: 1 } as const
type FieldType = keyof typeof WORDS
type Field = readonly [name: string, type: FieldType]

/** The view (view space +Z forward, reverse-Z, matrices column-major as the engine's) before its
 *  lights. `originShiftHigh`/`Low` are the camera shift split into two floats. */
const HEADER: readonly Field[] = [
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
  ['_pad0', 'u32'],
  ['depthFromDeviceZ', 'vec4f'],
  ['screenRayScale', 'vec4f'],
  ['halfFovTangents', 'vec4f'],
  ['viewPixels', 'vec4f'],
  ['clipToBufferUv', 'vec4f'],
  ['projectionRect', 'vec4i'],
]

/** A light of the pass: `radius` and `cosCone` are the lighting's range and cone
 *  (`localLightReaches`, −2 for any light but a spot), `direction` points towards the light. */
const LIGHT: readonly Field[] = [
  ['shiftedPosition', 'vec3f'],
  ['radius', 'f32'],
  ['direction', 'vec3f'],
  ['sourceRadius', 'f32'],
  ['cosCone', 'f32'],
  ['mapId', 'i32'],
  ['kind', 'u32'],
]

const wordsOf = (fields: readonly Field[]) => fields.reduce((sum, [, type]) => sum + WORDS[type], 0)
const offsetsOf = (fields: readonly Field[]) => {
  let at = 0
  const offsets: Record<string, number> = {}
  for (const [name, type] of fields) {
    offsets[name] = at
    at += WORDS[type]
  }
  return offsets
}
const structOf = (name: string, fields: readonly Field[], tail = '') =>
  `struct ${name}{\n${fields.map(([field, type]) => ` ${field}:${type},`).join('\n')}${tail}\n}`

/** Words of the header and of a light's record (a struct of 16-byte rows, its tail padded). */
export const VSM_PROJECTION_HEADER_WORDS = wordsOf(HEADER)
export const VSM_PROJECTION_LIGHT_WORDS = ceilDiv(wordsOf(LIGHT), 4) * 4
/** Lights per dispatch: the frame's shadowed lights (`assignSlice`'s 64 channels). */
export const VSM_PROJECTION_MAX_PASS_LIGHTS = 64
/** Byte size of `VsmProjectionView` (uniform). */
export const VSM_PROJECTION_VIEW_BYTES =
  4 * (VSM_PROJECTION_HEADER_WORDS + VSM_PROJECTION_MAX_PASS_LIGHTS * VSM_PROJECTION_LIGHT_WORDS)

/** The word of each header field, and of each light field in its record. */
export const VSM_PROJECTION_VIEW_WORD = offsetsOf(HEADER) as Record<
  (typeof HEADER)[number][0],
  number
>
export const VSM_PROJECTION_LIGHT_WORD = offsetsOf(LIGHT) as Record<
  (typeof LIGHT)[number][0],
  number
>

/** `VsmProjectionLight`, as the traces and the region test read it. */
export const VSM_PROJECTION_LIGHT_STRUCT = structOf('VsmProjectionLight', LIGHT)
/** `VsmProjectionView`, its lights after the header. */
export const VSM_PROJECTION_VIEW_STRUCT = structOf(
  'VsmProjectionView',
  HEADER,
  `\n lights:array<VsmProjectionLight,${VSM_PROJECTION_MAX_PASS_LIGHTS}>,`,
)
