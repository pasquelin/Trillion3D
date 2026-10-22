import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../../../lighting/deferred/shaders.ts'
import { FINISH_WGSL } from '../../../finish/finishWgsl.ts'

/** The uniform of the convolution's input: the inverse size of the image it writes, and 1 where the
 *  local exposure's layers are applied. */
export const CONVOLUTION_INPUT = fieldLayout('Input', [
  ['outTexel', 'vec2f'],
  ['layers', 'f32'],
] as const)
/** Bytes of the convolution input's uniform. */
export const CONVOLUTION_INPUT_BYTES = CONVOLUTION_INPUT.words * 4

/** The bindings of the convolution's input, by the names the shader gives them. */
export const INPUT_BINDINGS = { image: 0, reader: 1, params: 2 } as const

/**
 * THE IMAGE THE CONVOLUTION READS WHEN IT IS NOT THE LEVEL ITSELF, one pixel of the level it is read
 * from to one of the image it transforms: one bilinear read at the pixel's centre, which brings a
 * level down to a fraction of its size, and the local exposure of the finishing applied where the
 * layers are. The transform's own first pass loads what this leaves, holds it to light that is a
 * number and boosts what is bright (`./fftWgsl.ts`): a level that needs neither is read as it is.
 */
export const CONVOLUTION_INPUT_WGSL = wgslProgram(
  `
${CONVOLUTION_INPUT.wgsl}
@group(0) @binding(${INPUT_BINDINGS.image}) var image:texture_2d<f32>;
@group(0) @binding(${INPUT_BINDINGS.reader}) var reader:sampler;
@group(0) @binding(${INPUT_BINDINGS.params}) var<uniform> input:Input;
@fragment fn convolutionInput(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 var c=textureSampleLevel(image,reader,pixel.xy*input.outTexel,0.0);
 if(input.layers!=0.0){c=vec4f(c.rgb*localGainOf(c,floor(pixel.xy)*input.outTexel),c.a);}
 return c;
}`,
  [FINISH_WGSL, FULLSCREEN_VERTEX],
)
