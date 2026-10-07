import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { pixelToNdc, unprojectPoint } from '../../../../math/src/wgsl/projection.ts'

/** View uniform, shared by both programs and by the water composite: `viewport` carries the
 *  size, the raw-output flag of diagnostic views and the rank of a sampled image
 *  (`../direct/lightSamplingWgsl.ts`); `lightParams` the contract light count, tiles in X and Y, and
 *  exposure, applied before the display curve; `display.x` the rank of that curve
 *  (`../toneMappingWgsl.ts`), `display.yzw` the eye the fog is measured from; `jitter` the TAA's
 *  (`shadowJitterWords`, `jitterWords.ts`). The environment's irradiance and fog travel with the lights. */
export const VIEW_WGSL = wgslBlock(
  'VIEW_WGSL',
  [],
  'struct View{inverseViewProjection:mat4x4f,camera:vec4f,viewport:vec4f,background:vec4f,lightParams:vec4f,display:vec4f,jitter:vec4f,}',
)
/** World position of a pixel at a depth, reconstructed through that view: the one reading of
 *  the depth buffer every fullscreen pass shares. */
export const WORLD_AT_WGSL = wgslBlock(
  'WORLD_AT_WGSL',
  [VIEW_WGSL, pixelToNdc, unprojectPoint],
  `
fn worldAt(pixel:vec2f,z:f32)->vec3f{
 return unprojectPoint(view.inverseViewProjection,vec3f(pixelToNdc(pixel,view.viewport.xy),z));
}`,
)
