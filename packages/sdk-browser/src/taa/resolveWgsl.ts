import { BLUR_TAP, MEASURES, taaPrelude, taaShareTap, texelReads } from './shaderWgsl.ts'
import { shareText, taaHistoryBlend } from './historyWgsl.ts'
import { TAA_WINDOW_WGSL } from './filterWeights.ts'
import { layerText, taaOut } from './layers.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/**
 * The temporal resolve, the one program of every render scale — a frame drawn at the display's
 * size is the ratio one of it: it runs per DISPLAY pixel, history at display size, the current
 * image, depth, identifiers and flags at render size (`view.render`). The display pixel's place in
 * the render grid is `r = uv · render − 0.5`, texel centres at integers.
 *
 * First the history: the nearest surface of the 3×3 (reversed depth: the greatest) gives the depth
 * and the identifier that reproject the unjittered display-pixel centre (`previous`), how far the
 * history moved under the pixel in display pixels (`speed`), the image's motion as one continuous
 * weight (`motion`: the image changed, `view.jitter.z`, or the history slid), and how much of the
 * history is refused (`refused`: none, off screen, or another surface's geometry, as far as the
 * image moved).
 *
 * Then one loop over the 3×3 render texels: each sample, at the squared distance from where this
 * frame sampled it — its centre moved by the jitter — to `r`, weighed by ONE non-negative window
 * (`taaWindow`, a polynomial of the squared distance: no root, no cosine) whose footprint is one
 * DISPLAY pixel wherever the history is kept, at rest and in motion alike — the phases rebuild the
 * display size's detail —, widening to one render pixel as the history is refused, where the image
 * alone must fill the pixel. The value is the weighted mean, the centre sample where no tap weighs;
 * its weight in the history's accumulation is the window total (`sampleWeight`). The as-is share and
 * the display layers (`layers.ts`) follow the colour's weights; the blend is `taaHistoryBlend`.
 *
 * Per pixel: 9 colour loads (a blended or filtered layout's 9 more each), the 3×3 depth and
 * identifier gathers and 4 more depth loads for the slope (`closestSurface`), 9 windows of 8 FMA.
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
 let nearDepth=nearest.depth;let nearId=nearest.id;let nearPage=pageOf(nearId);
 let geometry=vec2u(nearPage.identity,bitcast<u32>(nearDepth));
 let here=pixelPoint(coord,nearDepth);let before=pointBefore(here,nearId);let previous=previousProjected(before);
 let speed=length(previous.xy*view.viewport.xy-vec2f(coord)-0.5);
 let motion=max(view.jitter.z,saturate(speed));
 var refused=1.0;
 if(view.params.y!=0.0&&previous.w!=0.0){refused=motion*f32(geometryUncovered(previous.xy,previous.z,geometry.x,nearest.slope));}
 let scale=mix(view.viewport.x*view.render.z,1.0,refused);let footprint=scale*scale;
 var sum=vec4f(0.0);var total=0.0;var blur=vec3f(0.0);var middle=vec4f(0.0);
 var lo=vec4f(RANGE_BOUND);var hi=vec4f(-RANGE_BOUND);
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layerText(filtered, 'vars')} for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let at=clampToExtent(base+vec2i(dx,dy),size);
  let sample=${read.color('at')};
  let offset=vec2f(at)+sampled;
  let weight=taaWindow(dot(offset,offset)*footprint);
  sum+=sample*weight;total+=weight;
  if(dx==0&&dy==0){middle=sample;}
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
${BLUR_TAP}${taaShareTap(asIs, read)}${layerText(filtered, 'tap')} }}
 var filtered=select(middle,sum/max(total,1e-30),total>0.0);
${share(' share=clamp(share/max(total,1e-4),shareLo,shareHi);\n')}${layerText(filtered, 'scaled')} let centre=clampToExtent(base,size);
 let sampleWeight=total;var count=sampleWeight;
${MEASURES}
 if(refused>=1.0){return ${taaOut(asIs, filtered)};}
${taaHistoryBlend(asIs, filtered)}
}`,
    [taaPrelude(asIs, blended, filtered), TAA_WINDOW_WGSL],
  )
}
