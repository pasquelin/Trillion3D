import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { MODEL_FLAG, SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'

/** The rewrite's program: the fullscreen vertex stage and the fragment that rewrites the lit pixels' roughness and diffuse colour. */
export const REWRITE_CODE = wgslProgram(
  `struct Rewrite{diffuse:vec4f,roughness:vec4f,}
@group(0) @binding(0) var copied:texture_2d_array<f32>;
@group(0) @binding(1) var flags:texture_2d<u32>;
@group(0) @binding(2) var<uniform> rewrite:Rewrite;
struct Rewritten{@location(0) base:vec4f,@location(1) normal:vec4f,}
@fragment fn rewriteSurface(@builtin(position) pixel:vec4f)->Rewritten{
 let at=vec2i(pixel.xy);
 var out:Rewritten;
 out.base=textureLoad(copied,at,0,0);
 out.normal=textureLoad(copied,at,1,0);
 let model=textureLoad(flags,at,0).r&${SURFACE_MODEL_MASK}u;
 if(model!=${MODEL_FLAG.physical}u&&model!=${MODEL_FLAG.diffuse}u){return out;}
 out.base=vec4f(out.base.rgb*rewrite.diffuse.w+rewrite.diffuse.xyz,out.base.a);
 if(rewrite.roughness.z!=0.0){out.normal.a=saturate(out.normal.a)*rewrite.roughness.y+rewrite.roughness.x;}
 return out;
}`,
  [FULLSCREEN_VERTEX],
)
