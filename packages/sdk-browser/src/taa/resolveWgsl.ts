import { BLUR_TAP, MEASURES, taaPrelude, taaShareTap, texelReads } from './shaderWgsl.ts'
import { shareText, taaHistoryBlend } from './historyWgsl.ts'
import { BLACKMAN_HARRIS_WGSL } from './filterWeights.ts'
import { layerText, taaOut } from './layers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/**
 * The temporal resolve, the one program of every render scale — a frame drawn at the display's
 * size is the ratio one of it (depth dilation, reconstruction and a YCoCg history box, folded into
 * the one pass): it runs per DISPLAY pixel, history at display size, the current image, depth,
 * identifiers and flags at render size (`view.render`). The display pixel's place in the render
 * grid is `r = uv · render − 0.5`, texel centres at integers. One loop over the 3×3 render texels
 * around it:
 * - depth dilation: the nearest surface (reversed depth: the greatest) gives the depth and the
 *   texel whose identifier reprojects, so a moving edge carries its own motion;
 * - each texel's sample, at the distance `gap` from where this frame sampled it — its centre moved
 *   by the jitter, in render pixels — to `r`, weighed by ONE kernel, the Blackman-Harris window
 *   (`BLACKMAN_HARRIS_WGSL`): non-negative, so nothing rings and no box of the nearest texels is read
 *   to clamp it. Its footprint is the uniform's one choice (`footprint`): unresampled, one DISPLAY
 *   pixel (`gap · toDisplay`), the phases then rebuilding the display size's detail; resampled, one
 *   render pixel, a reconstruction that always holds samples. At the display's size both are one
 *   pixel: the native window, its weights those the CPU table held, now evaluated where they are read;
 * - the YCoCg box history is clamped to.
 * The value is the weighted mean (`sum / total`), the centre texel's sample where no tap weighs —
 * a still display pixel no sample fell near this image —, and its weight the history takes it with
 * (`sampleWeight`, `historyWgsl.ts`): unresampled, the window total; resampled, `reach`, the window
 * of the nearest sample's distance in display pixels past the one a frame at the display's size has
 * — one at the display's size, as the native resolve took it — so a sample that fell far from the
 * display pixel does not overwrite its history. Reprojection starts from the unjittered
 * display-pixel centre at the dilated depth; the blend is `taaHistoryBlend`, the tag written the
 * dilated texel's. The as-is share and the display layers (`layers.ts`) follow the colour's weights.
 *
 * Per pixel: 9 colour loads (a blended or filtered layout's 9 more each), 9 `length`, 9 window
 * evaluations (one `cos` each), and in motion one more for `reach`. Before: the native resolve took
 * its 9 weights from the uniform; the reconstructing one evaluated 9 Lanczos-2 (two `sin`, a divide)
 * and read 4 more texels for its ring, at rest 9 more windows besides.
 */
export const taaResolveShader = (asIs: boolean, blended = false, filtered = false) => {
  const share = shareText(asIs),
    read = texelReads(blended)
  return wgslProgram(
    `@fragment fn resolve(@builtin(position) pixel:vec4f)->TaaOut{
 let coord=vec2i(pixel.xy);
 let r=pixel.xy*view.viewport.zw*view.render.xy-0.5;
 let base=vec2i(floor(r+0.5));
 let size=vec2i(view.render.xy);let last=size-vec2i(1);
 let sampled=vec2f(-view.jitter.x,view.jitter.y)-r;
 let nearest=closestSurface(clampToExtent(base,size),last);
 let nearDepth=nearest.depth;let depthSlack=nearest.slope;
 var sum=vec4f(0.0);var total=0.0;var closest=2.0;var blur=vec3f(0.0);var middle=vec4f(0.0);
 var lo=vec4f(RANGE_BOUND);var hi=vec4f(-RANGE_BOUND);
 let resampled=view.jitter.z;let toDisplay=view.viewport.x*view.render.z;
 let footprint=select(toDisplay,1.0,resampled>0.0);
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layerText(filtered, 'vars')} for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let tap=base+vec2i(dx,dy);
  let at=clampToExtent(tap,size);
  let sample=${read.color('at')};
  let gap=length(vec2f(at)+sampled);
  let weight=blackmanHarris(gap*footprint);closest=min(closest,gap);
  sum+=sample*weight;total+=weight;
  if(dx==0&&dy==0){middle=sample;}
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
${BLUR_TAP}${taaShareTap(asIs, read)}${layerText(filtered, 'tap')} }}
 var filtered=select(middle,sum/max(total,1e-30),total>0.0);
${share(' share=clamp(share/max(total,1e-4),shareLo,shareHi);\n')}${layerText(filtered, 'scaled')} let centre=clampToExtent(base,size);
 var sampleWeight=total;
 if(resampled>0.0){sampleWeight=blackmanHarris(closest*(toDisplay-1.0));}
 var count=sampleWeight;
 let nearId=nearest.id;let nearPage=pageOf(nearId);let geometry=vec2u(nearPage.identity,bitcast<u32>(nearDepth));
${MEASURES}
 if(view.params.y==0.0){return ${taaOut(asIs, filtered)};}
 let here=pixelPoint(coord,nearDepth);let before=pointBefore(here,nearId);let previous=previousProjected(before);
${taaHistoryBlend(asIs, filtered)}
}`,
    [taaPrelude(asIs, blended, filtered), BLACKMAN_HARRIS_WGSL],
  )
}
