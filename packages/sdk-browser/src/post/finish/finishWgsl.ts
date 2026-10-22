import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { LOCAL_LOG_WGSL } from '../exposure/localLogWgsl.ts'
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
 * THE DISPLAY FINISHING, in group 1 of the programs that read it: the local exposure, the tint,
 * the glow, the vignette and the grain, applied to the radiance after its exposure is known and
 * before the curve, the colour fringe on the way in and the dither on the way out.
 * - `lightLog` is the log2 of a colour's luminance, read as the exposure reads it.
 * - `baseLog` the base layer's log luminance at `uv`, exposure applied: the bilateral grid's
 *   cell — the grid's trilinear read at the pixel's own luminance, the mean of the log luminance
 *   of the pixels near it and as bright —, mixed with the blurred luminance; where the grid holds
 *   no pixel the blurred one alone.
 * - `localGain` the multiplier that moves a pixel's light from where it is to where the layers
 *   put it: the base's distance from middle grey, past the threshold that keeps its own contrast
 *   (a smoothstep over `reach`), scaled by the highlights' or the shadows' contrast, plus the
 *   detail — the pixel's distance from the base — scaled by its strength.
 * - `localGainOf` the gain of a source pixel, 1 where the local exposure is off: the composition
 *   asks it once, for the sharpening's edge test and for `finished`.
 * - `fringeActive` and `fringeTaps`: where the red and the green of a pixel are read, as `uv`s —
 *   each the pixel's own, moved toward the centre by `saturate(|q| − start)` times its shift, `q`
 *   the position from −1 to 1 on each axis.
 * - `vignetteMask` the falloff, a colour: the cosine-fourth law `1 / (1 + (v · r)²)²`, `r` the
 *   distance from the centre — moved by `around` — over a circle through the corners, `v` the
 *   strength; or the oval, `(1 − |size⁻¹ · r − centre|²)` to the softness, mixed in by the
 *   strength; mixed from the vignette's colour to 1.
 * - `grainWeight` the grain's strength at a pixel's exposed light: its three shares weighted by
 *   two smoothsteps of the luminance, the dark one falling to 0 at `grainBounds.x`, the bright
 *   one rising from `grainBounds.y` to `grainBounds.z`; `grained` multiplies a light by the
 *   texture's noise, normalised by `grainDecode` to a mean of 1, mixed in by that weight.
 * - `ditherOf` the triangular noise of one display step: the sine hash of the position and the
 *   frame's offset, `fract(sin(x + y · 543.31) · 493013)`, taken to [−1, 1] as `n` and made
 *   triangular by `s − s · √(1 − |n|)`, `s` the sign of `n`.
 * - `finished` composes a pixel: its light times the tint and the local gain, the glow added,
 *   the whole times the vignette, then the grain. The exposure multiplies the result.
 */
export const FINISH_WGSL = wgslBlock(
  'FINISH_WGSL',
  [WITH_GLOW_WGSL, LOCAL_LOG_WGSL],
  `
${FINISH.wgsl}
@group(1) @binding(0) var<uniform> finish:Finish;
@group(1) @binding(1) var grid:texture_3d<f32>;
@group(1) @binding(2) var blurredLog:texture_2d<f32>;
@group(1) @binding(3) var finishSampler:sampler;
@group(1) @binding(4) var glowImage:texture_2d<f32>;
@group(1) @binding(5) var grainImage:texture_2d<f32>;
@group(1) @binding(6) var grainSampler:sampler;
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
 let placed=localLog(base,finish.base.x,finish.base.yz,finish.grid.zw,finish.reach.xy);
 return exp2(placed+(logExposed-base)*finish.base.w-logExposed);
}
fn localGainOf(source:vec4f,uv:vec2f)->f32{
 if(finish.look.z==0.0){return 1.0;}
 return localGain(lightLog(source.rgb/max(source.a,1e-6)),uv);
}
fn fringeActive()->bool{return finish.fringe.w!=0.0;}
fn fringeTaps(uv:vec2f)->vec4f{
 let q=uv*2.0-vec2f(1.0);
 let away=sign(q)*saturate(abs(q)-vec2f(finish.fringe.z));
 return vec4f((q-away*finish.fringe.x+vec2f(1.0))*0.5,(q-away*finish.fringe.y+vec2f(1.0))*0.5);
}
fn vignetteMask(uv:vec2f)->vec3f{
 let strength=finish.look.x;
 if(strength<=0.0){return vec3f(1.0);}
 let p=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0)*finish.screen.xy;
 var weight=0.0;
 if(finish.screen.z==0.0){
  let q=(p-finish.around.xy)*strength;
  let falloff=1.0/(dot(q,q)+1.0);
  weight=falloff*falloff;
 }else{
  let d=finish.around.zw*p-finish.around.xy;
  weight=mix(1.0,pow(saturate(1.0-dot(d,d)),finish.shape.w),strength);
 }
 return mix(finish.shape.xyz,vec3f(1.0),weight);
}
fn hermite(low:f32,high:f32,x:f32)->f32{
 let t=saturate((x-low)/(high-low));
 return t*t*(3.0-2.0*t);
}
fn grainWeight(light:vec3f)->f32{
 let luma=dot(light,finish.grainLuma.xyz);
 let shadows=1.0-hermite(0.0,finish.grainBounds.x,luma);
 let highlights=hermite(finish.grainBounds.y,finish.grainBounds.z,luma);
 return finish.grainLevels.x*shadows+finish.grainLevels.y*(1.0-shadows-highlights)+finish.grainLevels.z*highlights;
}
fn grained(lit:vec3f,coverage:f32,uv:vec2f)->vec3f{
 if(finish.grainLevels.w==0.0){return lit;}
 let weight=grainWeight(lit*finish.look.y/max(coverage,1e-6));
 let raw=textureSampleLevel(grainImage,grainSampler,uv*finish.grainUv.xy+finish.grainUv.zw,0.0).rgb;
 return lit*mix(vec3f(1.0),raw*finish.grainDecode.xyz,weight);
}
fn ditherOf(uv:vec2f)->f32{
 let noise=fract(sin(uv.x+finish.dither.y+(uv.y+finish.dither.z)*543.31)*493013.0)*2.0-1.0;
 let side=sign(noise);
 return (side-side*sqrt(saturate(1.0-abs(noise))))*finish.dither.x;
}
fn finished(source:vec4f,uv:vec2f,gain:f32)->vec4f{
 var value=vec4f(source.rgb*finish.tint.xyz*gain,source.a);
 if(finish.look.w!=0.0){value=withGlow(value,textureSampleLevel(glowImage,finishSampler,uv,0.0));}
 return vec4f(grained(value.rgb*vignetteMask(uv),value.a,uv),value.a);
}`,
)
