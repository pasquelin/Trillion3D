import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { LOCAL_LOG_WGSL } from '../exposure/localLogWgsl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { FILM } from '../../lighting/filmCurveConstants.ts'
import { FINISH, GRID_DEPTH } from './finishLayout.ts'

/**
 * The weights of a colour's channels in the luminance the grain's zones read: the grading gamut's
 * luminance row carried through the matrix from that gamut to sRGB — the matrix applied to the
 * row, as the reference writes it, so that blue weighs under 0 and a blue pixel reads as dark;
 * the same three numbers at every image, baked into the shader (`grainWeight`).
 */
export const GRAIN_LUMA = [0, 1, 2].map((channel) => {
  const { luma, workingToSrgb } = FILM.numbers
  return (
    luma[0] * workingToSrgb[channel] +
    luma[1] * workingToSrgb[3 + channel] +
    luma[2] * workingToSrgb[6 + channel]
  )
})
/** The dither's hash of a position: the fraction of a large multiple of a sine, the position's
 *  second coordinate weighed by the first number, the sine by the second. */
const HASH_SKEW = 543.31
const HASH_SCALE = 493013

/**
 * A pixel with the bloom's glow added: what the glow leaves of the pixel, the glow with its dirt, the
 * two summed. The pixel's colour is multiplied by `keep` — what a convolution's glow took from the
 * image — where its fourth word is set, the glow by `1 + mask × dirt`, the dirt a lens shows where
 * light spills over it (the mask's filtered colour times the factor, per channel, the coverage
 * kept), where its fourth word is set; the two summed, light and coverage, the coverage up to 1,
 * so a glow over what the image leaves bare shows over its background. The one step the bloom's own
 * pass and the composition take.
 */
export const GLOWED_PIXEL_WGSL = wgslFn(
  'glowedPixel',
  [],
  `fn glowedPixel(base:vec4f,keep:vec4f,glow:vec4f,mask:vec3f,dirt:vec4f)->vec4f{
 var light=base;
 if(keep.w!=0.0){light=vec4f(light.rgb*keep.xyz,light.a);}
 var added=glow;
 if(dirt.w!=0.0){added=vec4f(glow.rgb*(vec3f(1.0)+mask*dirt.xyz),glow.a);}
 return vec4f(light.rgb+added.rgb,min(light.a+added.a,1.0));
}`,
)

/**
 * THE DISPLAY FINISHING, in group 1 of the programs that read it: the local exposure, the tint,
 * the glow, the vignette and the grain, applied to the radiance after its exposure is known and
 * before the curve, the colour fringe on the way in and the dither on the way out. Every effect
 * the settings leave off is skipped by a test of one uniform word — the same for every pixel of
 * the draw —, so a pixel does none of its work and reads none of its textures.
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
 * - `vignetteMask` the falloff, a colour (the weight alone where the colour is black): the cosine-fourth law `1 / (1 + (v · r)²)²`, `r` the
 *   distance from the centre — moved by `around` — over a circle through the corners, `v` the
 *   strength; or the oval, `(1 − |size⁻¹ · r − centre|²)` to the softness, mixed in by the
 *   strength; mixed from the vignette's colour to 1.
 * - `grainWeight` the grain's strength at a pixel's exposed light: its three shares weighted by
 *   two smoothsteps of the luminance, the dark one falling to 0 at `grainBounds.x`, the bright
 *   one rising from `grainBounds.y` to `grainBounds.z`; `grained` multiplies a light by the
 *   texture's noise, normalised by `grainDecode` to a mean of 1, mixed in by that weight.
 * - `ditherOf` the triangular noise of one display step, 0 where none is drawn: the sine hash of
 *   the position and the frame's offset, `fract(sin(x + y · 543.31) · 493013)`, taken to [−1, 1]
 *   as `n` and made triangular by `s − s · √(1 − |n|)`, `s` the sign of `n` (`triangular`,
 *   `grain.ts`, is the same law).
 * - `finished` composes a pixel: its light times the local gain, the tint and what the glow left it
 *   (`keep`), the glow added — times the dirt the mask shows (`dirt`) —, the whole times the
 *   vignette, then the grain. The exposure multiplies the result.
 */
export const FINISH_WGSL = wgslBlock(
  'FINISH_WGSL',
  [GLOWED_PIXEL_WGSL, LOCAL_LOG_WGSL],
  `
${FINISH.wgsl}
@group(1) @binding(0) var<uniform> finish:Finish;
@group(1) @binding(1) var grid:texture_3d<f32>;
@group(1) @binding(2) var blurredLog:texture_2d<f32>;
@group(1) @binding(3) var finishSampler:sampler;
@group(1) @binding(4) var glowImage:texture_2d<f32>;
@group(1) @binding(5) var grainImage:texture_2d<f32>;
@group(1) @binding(6) var grainSampler:sampler;
@group(1) @binding(7) var dirtImage:texture_2d<f32>;
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
 let p=vec2f(uv.x*2.0-1.0,1.0-uv.y*2.0)*finish.screen.xy;
 var weight=0.0;
 if(finish.screen.z==0.0){
  let q=(p-finish.around.xy)*finish.look.x;
  let falloff=1.0/(dot(q,q)+1.0);
  weight=falloff*falloff;
 }else{
  let d=finish.around.zw*p-finish.around.xy;
  weight=mix(1.0,pow(saturate(1.0-dot(d,d)),finish.shape.w),finish.look.x);
 }
 if(finish.screen.w==0.0){return vec3f(weight);}
 return mix(finish.shape.xyz,vec3f(1.0),weight);
}
const GRAIN_LUMA=vec3f(${GRAIN_LUMA.map(wgslF32).join(',')});
fn grainWeight(light:vec3f)->f32{
 let luma=dot(light,GRAIN_LUMA);
 let shadows=1.0-smoothstep(0.0,finish.grainBounds.x,luma);
 let highlights=smoothstep(finish.grainBounds.y,finish.grainBounds.z,luma);
 return finish.grainLevels.x*shadows+finish.grainLevels.y*(1.0-shadows-highlights)+finish.grainLevels.z*highlights;
}
fn grained(lit:vec3f,coverage:f32,uv:vec2f)->vec3f{
 if(all(finish.grainLevels.xyz==vec3f(0.0))){return lit;}
 let weight=grainWeight(lit*finish.look.y/max(coverage,1e-6));
 let raw=textureSampleLevel(grainImage,grainSampler,uv*finish.grainUv.xy+finish.grainUv.zw,0.0).rgb;
 return lit*mix(vec3f(1.0),raw*finish.grainDecode.xyz,weight);
}
fn ditherOf(uv:vec2f)->f32{
 if(finish.dither.x==0.0){return 0.0;}
 let noise=fract(sin(uv.x+finish.dither.y+(uv.y+finish.dither.z)*${HASH_SKEW})*${HASH_SCALE}.0)*2.0-1.0;
 let side=sign(noise);
 return (side-side*sqrt(saturate(1.0-abs(noise))))*finish.dither.x;
}
fn finished(source:vec4f,uv:vec2f,gain:f32)->vec4f{
 var light=source.rgb*gain;
 if(finish.tint.w!=0.0){light=light*finish.tint.xyz;}
 var value=vec4f(light,source.a);
 if(finish.look.w!=0.0){
  let glow=textureSampleLevel(glowImage,finishSampler,uv,0.0);
  var mask=vec3f(0.0);
  if(finish.dirt.w!=0.0){mask=textureSampleLevel(dirtImage,finishSampler,uv,0.0).rgb;}
  value=glowedPixel(value,finish.keep,glow,mask,finish.dirt);
 }
 if(finish.look.x>0.0){value=vec4f(value.rgb*vignetteMask(uv),value.a);}
 return vec4f(grained(value.rgb,value.a,uv),value.a);
}`,
)
