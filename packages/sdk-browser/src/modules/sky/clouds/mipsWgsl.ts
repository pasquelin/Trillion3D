import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { sum } from '../../../../../math/src/scalar/quantile.ts'

/**
 * THE MIP CHAIN OF A CLOUD TEXTURE, level by level: each level is made from the one above it, by one
 * of two filters, the one its texture's import setting names.
 *
 * - `average`, the setting that takes the texture group's filter: the mean of the 2×2 texels of
 *   the finer level a texel covers.
 * - `blur1`, the first blur setting: a Gaussian of four taps a side, centred between the two middle
 *   taps (variance 2, the taps normalised to one), the finer level read at the four texels
 *   starting one before the texel's own double, repeating at the edges (the square is a power of two
 *   and tiles), the result written as it is, with the four channels filtered alike.
 *
 * A level one texel wide is made of the finer level's two texels, the taps wrapping onto them.
 */

/** The filters, by the import setting each stands for. */
export type MipFilter = 'average' | 'blur1'

/** Taps of the blur's kernel, a side, and its variance. */
const BLUR_TAPS = 4
const BLUR_VARIANCE = 2

/** The blur's one-dimensional weights: a normal law centred between the middle taps, normalised. */
const blurWeights = () => {
  const centre = BLUR_TAPS / 2 - 0.5
  const raw = Array.from({ length: BLUR_TAPS }, (_, tap) =>
    Math.exp(-((tap - centre) ** 2) / (2 * BLUR_VARIANCE)),
  )
  const total = sum(raw)
  return raw.map((weight) => weight / total)
}

/** Texels a thread group covers along each axis. */
export const MIP_GROUP = 8

export const MIP_ENTRY_POINTS = ['averageMain', 'blurMain'] as const

const SOURCE = `
@group(0) @binding(0) var finer:texture_2d<f32>;
@group(0) @binding(1) var level:texture_storage_2d<rgba16float,write>;
const BLUR_WEIGHTS=array<f32,${BLUR_TAPS}>(${blurWeights().map(wgslF32).join(',')});

@compute @workgroup_size(${MIP_GROUP},${MIP_GROUP},1)
fn averageMain(@builtin(global_invocation_id) id:vec3u){
 let written=vec2i(textureDimensions(level));
 let at=vec2i(id.xy);
 if(any(at>=written)){return;}
 let last=vec2i(textureDimensions(finer))-vec2i(1);
 var sum=vec4f(0.0);
 for(var k=0;k<4;k++){
  sum+=textureLoad(finer,min(at*2+vec2i(k&1,k>>1),last),0);
 }
 textureStore(level,at,sum*0.25);
}

@compute @workgroup_size(${MIP_GROUP},${MIP_GROUP},1)
fn blurMain(@builtin(global_invocation_id) id:vec3u){
 let written=vec2i(textureDimensions(level));
 let at=vec2i(id.xy);
 if(any(at>=written)){return;}
 let wrap=vec2i(textureDimensions(finer))-vec2i(1);
 var sum=vec4f(0.0);
 for(var y=0;y<${BLUR_TAPS};y++){
  for(var x=0;x<${BLUR_TAPS};x++){
   let tap=(at*2+vec2i(x-1,y-1))&wrap;
   sum+=BLUR_WEIGHTS[y]*BLUR_WEIGHTS[x]*textureLoad(finer,tap,0);
  }
 }
 textureStore(level,at,sum);
}
`

/** The mips' whole shader. */
export const MIP_CODE = wgslProgram(SOURCE, [])
