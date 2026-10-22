import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { FINISH, GRID_DEPTH } from './finishLayout.ts'

/** A glow added to a pixel, both premultiplied: the light adds, and so does the coverage, up to
 *  1, so a glow over what the image leaves bare shows over its background. The one sum the bloom's
 *  own pass and the composition take. */
export const WITH_GLOW_WGSL = wgslFn(
  'withGlow',
  [],
  'fn withGlow(base:vec4f,glow:vec4f)->vec4f{return vec4f(base.rgb+glow.rgb,min(base.a+glow.a,1.0));}',
)

/**
 * THE DISPLAY FINISHING, in group 1 of the programs that read it: the local exposure, the glow
 * and the vignette, applied to the radiance after its exposure is known and before the curve.
 * - `lightLog` is the log2 of a colour's luminance, read as the exposure reads it.
 * - `baseLog` the base layer's log luminance at `uv`, exposure applied: the bilateral grid's
 *   cell — the grid's trilinear read at the pixel's own luminance, the mean of the log luminance
 *   of the pixels near it and as bright —, mixed with the blurred luminance; where the grid holds
 *   no pixel the blurred one alone.
 * - `localGain` the multiplier that moves a pixel's light from where it is to where the layers
 *   put it: the base's distance from middle grey, past the threshold that keeps its own contrast
 *   (a smoothstep over `reach`), scaled by the highlights' or the shadows' contrast, plus the
 *   detail — the pixel's distance from the base — scaled by its strength.
 * - `vignetteMask` the cosine-fourth falloff: `1 / (1 + (v · r)²)²`, `r` the distance from the
 *   centre over a circle through the corners, `v` the strength.
 * - `finished` composes a pixel: its light times the local gain, the glow added, the whole times
 *   the vignette. The exposure multiplies the result.
 */
export const FINISH_WGSL = wgslBlock(
  'FINISH_WGSL',
  [WITH_GLOW_WGSL],
  `
${FINISH.wgsl}
@group(1) @binding(0) var<uniform> finish:Finish;
@group(1) @binding(1) var grid:texture_3d<f32>;
@group(1) @binding(2) var blurredLog:texture_2d<f32>;
@group(1) @binding(3) var finishSampler:sampler;
@group(1) @binding(4) var glowImage:texture_2d<f32>;
fn lightLog(c:vec3f)->f32{return log2(max(dot(c,finish.weights.xyz),finish.weights.w));}
fn baseLog(logLight:f32,uv:vec2f)->f32{
 let depth=((logLight*finish.histogram.x+finish.histogram.y)*${GRID_DEPTH - 1}.0+0.5)/${GRID_DEPTH}.0;
 let cell=textureSampleLevel(grid,finishSampler,vec3f(uv*finish.grid.xy,depth),0.0).xy;
 let blurred=textureSampleLevel(blurredLog,finishSampler,uv,0.0).x;
 let bilateral=select(cell.x/cell.y,blurred,cell.y<finish.histogram.w);
 return mix(bilateral,blurred,finish.histogram.z)+log2(finish.look.y);
}
fn localGain(logLight:f32,uv:vec2f)->f32{
 let logExposed=logLight+log2(finish.look.y);
 let base=baseLog(logLight,uv);
 var centred=base-finish.base.x;
 let high=centred>0.0;
 let contrast=select(finish.base.z,finish.base.y,high);
 let edge=select(finish.grid.w,finish.grid.z,high);
 let reach=select(finish.reach.y,finish.reach.x,high);
 let kept=select(min(0.0,centred+edge),max(0.0,centred-edge),high);
 let grown=saturate((abs(centred)-edge)/reach);
 let shift=(centred-kept)*(1.0-grown*grown*(3.0-2.0*grown));
 centred=centred-shift;
 return exp2(finish.base.x+shift+centred*contrast+(logExposed-base)*finish.base.w-logExposed);
}
fn vignetteMask(uv:vec2f)->f32{
 let q=(uv*2.0-vec2f(1.0))*finish.screen.xy*finish.look.x;
 let falloff=1.0/(dot(q,q)+1.0);
 return falloff*falloff;
}
fn finished(source:vec4f,uv:vec2f)->vec4f{
 var scene=source.rgb;
 if(finish.look.z!=0.0){scene=scene*localGain(lightLog(source.rgb/max(source.a,1e-6)),uv);}
 var value=vec4f(scene,source.a);
 if(finish.look.w!=0.0){value=withGlow(value,textureSampleLevel(glowImage,finishSampler,uv,0.0));}
 return vec4f(value.rgb*vignetteMask(uv),value.a);
}`,
)
