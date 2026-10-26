import { fieldLayout, vec4Array } from '../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { preExposedWgsl } from '../post/exposure/preWgsl.ts'
import { BAKE_LAYOUT, BAKE_STRUCT_WGSL } from '../lighting/toneBakeWgsl.ts'

/**
 * The transparent pass's view uniform (`uniforms.ts`): its fields in one table, in order. The WGSL struct
 * (`BLEND_VIEW_WGSL`), its size (`BLEND_VIEW_SIZE`) and each field's word (`VIEW`), which the
 * writer reads, are all made of it. `camPos` is the camera as one homogeneous point; `viewRight`
 * and `viewUp` the camera's axes, which take a world vector to the view,
 * their `w` the distortion parameters folded, which scale a view-normal bend to the screen: the projection's `M[0][0]` times the unscaled (display) width, and times the view's aspect
 * and the display height; `clipW` the render matrix's last row, a point's
 * clip `w` its dot with the point; `eye` the
 * point the fog is measured from, `pixelError` the cut's threshold the screen-error view measures
 * against (`diagnosticScreenError`), `time` the world's seconds and `realTime` the wall clock's, which
 * a material graph reads (`../materials/graph/clocks.ts`); `clearCoatNormal` whether a clear
 * coat keeps a bottom normal (`clearCoatNormal`, 1 or 0, `../materials/surface/pixelModel.ts`); `clipPlane` the view's clip plane in the world, `dot(xyz, p) + w`
 * at least 0 drawn, all zero for a view that clips nothing (`../frame/render/viewClip.ts`); `bake`
 * a copy of the tone table's baking words (`../lighting/toneBakeWgsl.ts`), from which the layers
 * drawn on display values give the colours the table gives (`displayRoute`); `volumeCorner` and `volumeScale` the two
 * cascades of the translucency lighting volume — each the corner of its box with the reciprocal of its cells a side in
 * `w`, and the reciprocal of its size with the side of its cell in `w` —, `volumeRead` the cells a side (0 where no volume is
 * made this image), the noise on the point a surface reads it at, in cells, and the image's number
 * (`../lighting/translucency/readWgsl.ts`); `giGrid` the translucency global illumination volume's cells along the image (`x`, `y`) and
 * its depth (`z`), `w` 1 where a volume is made this image, else 0, and `giZ` its slices' law (the logarithm's scale, offset and the slices a
 * doubling: `../lighting/translucencyGi/readWgsl.ts`); `holdout` 1 where the alpha
 * holdout is in effect, which the layers of a held-out primitive read (`holdoutStageText`); `normalCurvature` the scale, bias and
 * exponent of the roughness a material takes from its vertex normal's change (`../materials/surface/pixelModel.ts`).
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
  ['preExposure', 'f32'],
  ['toneCurve', 'u32'],
  ['pixelError', 'f32'],
  ['time', 'f32'],
  ['realTime', 'f32'],
  ['clearCoatNormal', 'u32'],
  ['clipPlane', 'vec4f'],
  ['bake', { wgsl: BAKE_LAYOUT.name, words: BAKE_LAYOUT.words, align: BAKE_LAYOUT.align }],
  ['volumeCorner', vec4Array(2)],
  ['volumeScale', vec4Array(2)],
  ['volumeRead', 'vec4f'],
  ['giGrid', 'vec4f'],
  ['giZ', 'vec4f'],
  ['holdout', 'u32'],
  ['normalCurvature', 'vec3f'],
] as const
const LAYOUT = fieldLayout('BlendView', BLEND_VIEW_FIELDS)

/** Each field's first word in the view: constants, read by the writer as literal offsets were. */
export const VIEW = LAYOUT.at
/** The view's bytes: what its buffer, its words and its binding are sized at. */
export const BLEND_VIEW_SIZE = LAYOUT.words * 4
/** The pre-exposure the view holds (`uni.preExposure`): what every light a layer writes is
 *  multiplied by (`preExposed`, `preExposedClipped`). */
export const BLEND_PRE_EXPOSED_WGSL = preExposedWgsl('uni.preExposure')
/** WGSL declaration of the view, made of its table. */
export const BLEND_VIEW_WGSL = wgslBlock('BLEND_VIEW_WGSL', [BAKE_STRUCT_WGSL], LAYOUT.wgsl)
