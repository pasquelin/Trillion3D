import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../../lighting/deferred/shaders.ts'
import { FINISH_WGSL } from '../../finish/finishWgsl.ts'

/**
 * The uniform of the glow's finishing, one `vec4f` each:
 * - `keep`: what the image's own light is multiplied by before it is added to the glow — the
 *   convolution's tint less 1, so a tint under 1 dims the image where its light moved to the halo —,
 *   its last word 1 where it applies;
 * - `dirt`: the dirt mask's tint times its intensity over the bloom's, its last word 1 where the
 *   mask is on;
 * - `mode`: its first word 1 where the composition adds the glow to the image, whose tint and local
 *   exposure then multiply the dimmed light as they multiply the image; its next two the image's
 *   size in texels, which a pixel's place is read against.
 */
export const GLOW_SHAPE = fieldLayout('Shape', [
  ['keep', 'vec4f'],
  ['dirt', 'vec4f'],
  ['mode', 'vec4f'],
] as const)
/** Bytes of the glow's finishing's uniform. */
export const GLOW_SHAPE_BYTES = GLOW_SHAPE.words * 4

/**
 * THE GLOW, FINISHED, one pixel of the image: the glow read at the pixel's place, multiplied by
 * `1 + mask · tint` where the dirt mask is on — the mask read at the same place, filtered, at the
 * mip level its size asks —, and, where the image is dimmed (`keep`), the image's pixel times `keep`
 * added: a negative light, the light the glow took from the image, times the finishing's tint and
 * local gain where the composition adds the glow (`finished`, `../../finish/finishWgsl.ts`), so that
 * the sum the composition makes is the image times what it keeps plus the glow.
 */
export const GLOW_FINISH_WGSL = wgslProgram(
  `
${GLOW_SHAPE.wgsl}
@group(0) @binding(0) var scene:texture_2d<f32>;
@group(0) @binding(1) var glow:texture_2d<f32>;
@group(0) @binding(2) var dirtImage:texture_2d<f32>;
@group(0) @binding(3) var reader:sampler;
@group(0) @binding(4) var<uniform> shape:Shape;
@fragment fn glowFinish(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let uv=pixel.xy/shape.mode.yz;
 var value=textureSampleLevel(glow,reader,uv,0.0);
 if(shape.dirt.w!=0.0){
  let mask=textureSample(dirtImage,reader,uv).rgb;
  value=vec4f(value.rgb*(vec3f(1.0)+mask*shape.dirt.xyz),value.a);
 }
 if(shape.keep.w!=0.0){
  let source=textureLoad(scene,vec2i(pixel.xy),0);
  var lost=source.rgb*shape.keep.xyz;
  if(shape.mode.x!=0.0){lost=lost*finish.tint.xyz*localGainOf(source,uv);}
  value=vec4f(value.rgb+lost,value.a);
 }
 return value;
}`,
  [FINISH_WGSL, FULLSCREEN_VERTEX],
)
