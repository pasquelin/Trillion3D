import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../../../lighting/deferred/shaders.ts'
import { FINISH_WGSL } from '../../../finish/finishWgsl.ts'

/**
 * The uniform of the convolution's input: the inverse size of the image it writes, 1 where the
 * local exposure's layers are applied, and the boost of the bright pixels: the luminance above
 * which it starts, the most it reaches, the slope, 1 where it is on.
 */
export const CONVOLUTION_INPUT = fieldLayout('Input', [
  ['outTexel', 'vec2f'],
  ['layers', 'f32'],
  ['lift', 'vec4f'],
] as const)
/** Bytes of the convolution input's uniform. */
export const CONVOLUTION_INPUT_BYTES = CONVOLUTION_INPUT.words * 4

/**
 * THE IMAGE THE CONVOLUTION READS, one pixel of the level it is read from to one of the image it
 * transforms: one bilinear read at the pixel's centre, which brings a level down to a fraction of
 * its size —, the local exposure of the finishing applied where the layers are, a light of no colour
 * or a coverage of no number left at 0, and the bright pixels boosted. A pixel whose luminance in
 * the exposed radiance, `luminance · exposure`, is over `lift.x` takes `lift.z · (luminance − lift.x) +
 * lift.x`, at most `lift.y`: its colour is scaled by the ratio, its coverage kept. A pixel of no
 * luminance is left alone.
 */
export const CONVOLUTION_INPUT_WGSL = wgslProgram(
  `
${CONVOLUTION_INPUT.wgsl}
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var reader:sampler;
@group(0) @binding(2) var<uniform> input:Input;
fn atLeastZero(v:f32)->f32{return select(0.0,v,v>0.0);}
@fragment fn convolutionInput(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 var c=textureSampleLevel(image,reader,pixel.xy*input.outTexel,0.0);
 if(input.layers!=0.0){
  let gain=localGain(lightLog(c.rgb/max(c.a,1e-6)),floor(pixel.xy)*input.outTexel);
  c=vec4f(c.rgb*gain,c.a);
 }
 var rgb=select(vec3f(0.0),c.rgb,c.rgb>vec3f(0.0));
 let luma=dot(rgb,vec3f(0.2126,0.7152,0.0722))*finish.look.y;
 if(input.lift.w!=0.0&&luma>input.lift.x&&luma>0.0){
  let boosted=min(input.lift.z*(luma-input.lift.x)+input.lift.x,input.lift.y);
  rgb*=boosted/luma;
 }
 return vec4f(rgb,atLeastZero(c.a));
}`,
  [FINISH_WGSL, FULLSCREEN_VERTEX],
)
