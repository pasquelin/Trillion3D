import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The transparent pass's view uniform (`uniforms.ts`): its fields in one table, in order. The WGSL struct
 * (`BLEND_VIEW_WGSL`), its size (`BLEND_VIEW_SIZE`) and each field's word (`VIEW`), which the
 * writer reads, are all made of it. `camPos` is the camera as one homogeneous point; `viewRight`
 * and `viewUp` the camera's axes, which take a world vector to the view,
 * their `w` the distortion parameters folded, which scale a view-normal bend to the screen: the projection's `M[0][0]` times the unscaled (display) width, and times the view's aspect
 * and the display height; `clipW` the render matrix's last row, a point's
 * clip `w` its dot with the point; `eye` the
 * point the fog is measured from, `pixelError` the cut's threshold the screen-error view measures
 * against (`diagnosticScreenError`).
 */
const BLEND_VIEW_FIELDS = [
  ['viewProj', 'mat4x4f'],
  ['camPos', 'vec4f'],
  ['viewRight', 'vec4f'],
  ['viewUp', 'vec4f'],
  ['clipW', 'vec4f'],
  ['lightTiles', 'vec2f'],
  ['viewFlags', 'u32'],
  ['vertexShift', 'u32'],
  ['feedback', 'u32'],
  ['viewport', 'vec2f'],
  ['eye', 'vec3f'],
  ['pixelRatio', 'f32'],
  ['mipBias', 'f32'],
  ['exposure', 'f32'],
  ['toneCurve', 'u32'],
  ['pixelError', 'f32'],
] as const
const LAYOUT = fieldLayout('BlendView', BLEND_VIEW_FIELDS)

/** Each field's first word in the view: constants, read by the writer as literal offsets were. */
export const VIEW = LAYOUT.at
/** The view's bytes: what its buffer, its words and its binding are sized at. */
export const BLEND_VIEW_SIZE = LAYOUT.words * 4
/** WGSL declaration of the view, made of its table. */
export const BLEND_VIEW_WGSL = wgslBlock('BLEND_VIEW_WGSL', [], LAYOUT.wgsl)
