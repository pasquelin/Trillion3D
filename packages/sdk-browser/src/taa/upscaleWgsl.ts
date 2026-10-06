import {
  BLUR_TAP_WGSL,
  MEASURES_WGSL,
  taaPrelude,
  taaShareTap,
  texelReads,
  type TexelReads,
} from './shaderWgsl.ts'
import { shareText, taaHistoryBlend } from './historyWgsl.ts'
import { BLACKMAN_HARRIS_WGSL } from './filterWeights.ts'
import { layerWgsl, taaOut } from './layers.ts'
import { LANCZOS2_WGSL } from './lanczos2Wgsl.ts'

/** The 2×2 render texels nearest the display pixel, the box the Lanczos sum is clamped to: read
 *  again after the 3×3 — the cache's texels —, in its row order, so its box holds no registers
 *  through the loop and the loop tests no texel against it. */
const ringWgsl = (read: TexelReads) => ` for(var j=0;j<4;j++){
  let ring=${read.color('clamp(low+vec2i(j&1,j>>1),vec2i(0),last)')};
  ringLo=min(ringLo,ring);ringHi=max(ringHi,ring);
 }
`

/** A still image's taps, weighed by the Blackman-Harris window of one display pixel, in the 3×3's
 *  order: a loop of their own, run only at rest, so the moving image's loop carries no branch. */
const stillTapsWgsl = (
  read: TexelReads,
) => ` if(resting){for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let at=clamp(base+vec2i(dx,dy),vec2i(0),last);
  let hit=blackmanHarris(length(vec2f(at)+sampled)*toDisplay);still+=${read.color('at')}*hit;stillTotal+=hit;
 }}}
`

/**
 * Temporal resolve of a frame drawn below the display (depth dilation, Lanczos-2 reconstruction and a
 * YCoCg history box, folded into the one pass): it runs per DISPLAY pixel, history at display size, the current image, depth, identifiers
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
 * images by those weights (`stillAverage`, `historyWgsl.ts`): the phases then rebuild the display size's
 * detail, where a render-pixel kernel would soften it (#1343).
 */
export const taaUpscaleShader = (
  asIs: boolean,
  blended = false,
  filtered = false,
  reactive = true,
) => {
  const share = shareText(asIs),
    read = texelReads(blended)
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
 let nearest=closestSurface(clamp(base,vec2i(0),last),last);
 let near=vec2i(nearest.xy);let nearDepth=nearest.z;let depthSlack=nearest.w;
 var sum=vec4f(0.0);var total=0.0;var closest=2.0;var blur=vec3f(0.0);
 var lo=vec4f(1e9);var hi=vec4f(-1e9);var ringLo=vec4f(1e9);var ringHi=vec4f(-1e9);
 let resting=view.jitter.z==0.0;let toDisplay=view.viewport.x*view.render.z;
 var still=vec4f(0.0);var stillTotal=0.0;
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layerWgsl(filtered, 'vars')} for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let tap=base+vec2i(dx,dy);
  let at=clamp(tap,vec2i(0),last);
  let sample=${read.color('at')};
  let gap=length(vec2f(at)+sampled);
  let weight=lanczos2(gap);closest=min(closest,gap);
  sum+=sample*weight;total+=weight;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
${BLUR_TAP_WGSL}${taaShareTap(asIs, read)}${layerWgsl(filtered, 'tap')} }}
${ringWgsl(read)}${stillTapsWgsl(read)} var filtered=clamp(sum/max(total,1e-4),ringLo,ringHi);
 if(stillTotal>0.0){filtered=still/stillTotal;}
 var count=stillTotal;
${share(' share=clamp(share/max(total,1e-4),shareLo,shareHi);\n')}${layerWgsl(filtered, 'scaled')} let centre=clamp(base,vec2i(0),last);
 let reach=saturate(lanczos2(closest*toDisplay));
 let nearId=${read.id('near')};let nearPage=pageOf(nearId);let geometry=vec2u(nearPage.identity,bitcast<u32>(nearDepth));
${MEASURES_WGSL}
 if(view.params.y==0.0){return ${taaOut(asIs, filtered, false, true)};}
 let here=pixelPoint(coord,nearDepth);let before=pointBefore(here,nearId);let previous=previousProjected(before);
${taaHistoryBlend(asIs, filtered, true, 'nearPage', reactive)}
}`
}
