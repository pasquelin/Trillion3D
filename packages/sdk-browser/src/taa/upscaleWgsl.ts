import { shaderLanguage } from '../math/shaderLanguage.ts';
import { taaPrelude, taaShareTap } from './shaderWgsl.ts';
import { shareText, taaHistoryBlend } from './historyWgsl.ts';
import { BLACKMAN_HARRIS_WGSL } from './filterWeights.ts';
import { layerWgsl, taaOut } from './layers.ts';
import { LANCZOS2_WGSL } from './lanczos2Wgsl.ts';

/** The same kernel in GLSL, for WebGL2's spatial resample (`../webgl/core/resampleGlsl.ts`):
 *  `LANCZOS2_WGSL`'s own text through the shared translator (`shaderLanguage`). */
export const LANCZOS2_GLSL = shaderLanguage(LANCZOS2_WGSL, 'glsl');

/**
 * Temporal resolve of a frame drawn below the display (FSR 2's reconstruction, folded into the one
 * pass): it runs per DISPLAY pixel, history at display size, the current image, depth, identifiers
 * and flags at render size (`view.render`). The display pixel's place in the render grid is
 * `r = uv · render − 0.5`, texel centres at integers. Over the 3×3 render texels around it:
 * - depth dilation: the nearest surface (reversed depth: the greatest) gives the depth and the
 *   texel whose identifier reprojects, so a moving edge carries its own motion;
 * - the current sample: each texel weighed by Lanczos-2 of the distance from where this frame
 *   sampled it — its centre moved by the jitter, in render pixels, `weights.ts`'s convention — to
 *   `r`, then clamped to the 2×2 nearest texels, since Lanczos's negative lobes ring;
 * - the YCoCg box history is clamped to, as at native size.
 * Reprojection starts from the unjittered display-pixel centre at the dilated depth; the history
 * blend is the native resolve's (`taaHistoryBlend`), its `reach` the Lanczos-2 weight of the
 * nearest sample, its distance in display pixels (#833), and the tag written the dilated texel's.
 * The as-is share and the display layers (`layers.ts`) follow the colour's weights. A still image
 * weighs each sample by the Blackman-Harris window of one DISPLAY pixel instead, and averages its
 * images by those weights (`STILL_AVERAGE_WGSL`): the phases then rebuild the display size's
 * detail, where a render-pixel kernel would soften it (#1343).
 */
export const taaUpscaleShader = (asIs: boolean, blended = false, filtered = false) => {
  const share = shareText(asIs);
  return `${taaPrelude(asIs, blended, filtered)}
${LANCZOS2_WGSL}
${BLACKMAN_HARRIS_WGSL}
@fragment fn resolve(@builtin(position) pixel:vec4f)->TaaOut{
 let coord=vec2i(pixel.xy);
 let r=pixel.xy*view.viewport.zw*view.render.xy-0.5;
 let base=vec2i(floor(r+0.5));
 let low=vec2i(floor(r));
 let last=vec2i(view.render.xy)-vec2i(1);
 let sampled=vec2f(-view.jitter.x,view.jitter.y)-r;
 var near=clamp(base,vec2i(0),last);
 var nearDepth=-1.0;
 var sum=vec4f(0.0);var total=0.0;var closest=2.0;
 var lo=vec4f(1e9);var hi=vec4f(-1e9);var ringLo=vec4f(1e9);var ringHi=vec4f(-1e9);
 let resting=view.jitter.z==0.0;let toDisplay=view.viewport.x*view.render.z;
 var still=vec4f(0.0);var stillTotal=0.0;
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layerWgsl(filtered, 'vars')} for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let tap=base+vec2i(dx,dy);
  let at=clamp(tap,vec2i(0),last);
  let z=textureLoad(depth,at,0);
  if(z>nearDepth){nearDepth=z;near=at;}
  let sample=textureLoad(current,at,0);
  let gap=length(vec2f(at)+sampled);
  let weight=lanczos2(gap);closest=min(closest,gap);
  if(resting){let hit=blackmanHarris(gap*toDisplay);still+=sample*hit;stillTotal+=hit;}
  sum+=sample*weight;total+=weight;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
  let ring=tap-low;
  if(all(ring>=vec2i(0))&&all(ring<=vec2i(1))){ringLo=min(ringLo,sample);ringHi=max(ringHi,sample);}
${taaShareTap(asIs, blended)}${layerWgsl(filtered, 'tap')} }}
 var filtered=clamp(sum/max(total,1e-4),ringLo,ringHi);
 if(stillTotal>0.0){filtered=still/stillTotal;}
 var count=stillTotal;
${share(' share=clamp(share/max(total,1e-4),shareLo,shareHi);\n')}${layerWgsl(filtered, 'scaled')} let centre=clamp(base,vec2i(0),last);
 let reach=saturate(lanczos2(closest*toDisplay));
 let nearId=textureLoad(ids,near,0).r;let tag=f32(tagOf(nearId))/255.0;
 if(view.params.y==0.0){return ${taaOut(asIs, filtered, false, true)};}
 let previous=previousUv(coord,nearDepth,nearId);
${taaHistoryBlend(asIs, filtered, true)}
}`;
};
