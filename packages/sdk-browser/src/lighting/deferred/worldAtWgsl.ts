import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { pixelToNdc, unprojectPoint } from '../../../../math/src/wgsl/projection.ts'

/** View uniform, shared by both programs and by the distortion: `viewport` carries the
 *  size, the raw-output flag of diagnostic views and the composition's sharpening strength; `lightParams` the contract light count, tiles in X and Y, and
 *  the scene's exposure, which the lighting reads in the units of the light it traces; `display.x` the rank of that curve
 *  (`../toneMappingWgsl.ts`), `display.yzw` the eye the fog is measured from; `jitter` the TAA's
 *  (`viewJitterWords`, `jitterWords.ts`); `source` the composition's image: its pixels per display
 *  pixel on each axis (`xy`), and its last pixel (`zw`) (`view.ts`, `writeSource`); `views` the
 *  lighting term a view of the lit image shows in place of the surface (`x`, `LIT_VIEWS`,
 *  `../../visibility/shader/shadeMode.ts`, `writeLightView`; `y` how the ambient occlusion applies, 0 none,
 *  1 to the emission and the sky light, 2 to the screen probes' light, and `z` the share it applies at,
 *  `writeAmbientOcclusion`; `w` unused); `preExposure` the number every light is written multiplied
 *  by (`x`, `../../post/exposure/pre.ts`) and the scale the composition multiplies the image by
 *  (`y`): the exposure over that number, the scene's, or the one an automatic exposure measured
 *  and copied there on the GPU (`../../post/exposure/frame.ts`). The
 *  environment's irradiance and fog travel with the lights. */
export const VIEW_LAYOUT = fieldLayout('View', [
  ['inverseViewProjection', 'mat4x4f'],
  ['camera', 'vec4f'],
  ['viewport', 'vec4f'],
  ['background', 'vec4f'],
  ['lightParams', 'vec4f'],
  ['display', 'vec4f'],
  ['jitter', 'vec4f'],
  ['source', 'vec4f'],
  ['views', 'vec4f'],
  ['preExposure', 'vec4f'],
] as const)
export const VIEW_WGSL = wgslBlock('VIEW_WGSL', [], VIEW_LAYOUT.wgsl)
/** World position of a pixel at a depth, reconstructed through that view: the one reading of
 *  the depth buffer every fullscreen pass shares. \`viewToEye\` is the direction from a point to the
 *  eye (the view direction, \`camera.w\` 0, under an orthographic camera): the one reading of the
 *  camera every lit pass shares. */
export const WORLD_AT_WGSL = wgslBlock(
  'WORLD_AT_WGSL',
  [VIEW_WGSL, pixelToNdc, unprojectPoint],
  `
fn worldAt(pixel:vec2f,z:f32)->vec3f{
 return unprojectPoint(view.inverseViewProjection,vec3f(pixelToNdc(pixel,view.viewport.xy),z));
}
fn viewToEye(P:vec3f)->vec3f{return normalize(view.camera.xyz-P*view.camera.w);}`,
)
