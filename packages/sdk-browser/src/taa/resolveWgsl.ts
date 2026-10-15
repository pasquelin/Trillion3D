import {
  BLUR_TAP,
  MEASURES,
  taaPrelude,
  taaShareTap,
  texelReads,
  type TexelReads,
} from './shaderWgsl.ts'
import { shareText, taaHistoryBlend } from './historyWgsl.ts'
import { BLACKMAN_HARRIS_WGSL } from './filterWeights.ts'
import { layerText, taaOut } from './layers.ts'
import { PI } from '../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'

/** Lanczos-2, `sinc(x)·sinc(x/2)` on `|x| < 2`: the kernel the current image is resampled with. */
const LANCZOS2_WGSL = wgslBlock(
  'LANCZOS2_WGSL',
  [PI],
  `fn lanczos2(x:f32)->f32{
 if(x<1e-4){return 1.0;}
 if(x>=2.0){return 0.0;}
 let p=PI*x;
 return 2.0*sin(p)*sin(0.5*p)/(p*p);
}`,
)

/** The 2×2 render texels whose samples bracket the display pixel, the box the Lanczos sum is
 *  clamped to — their samples sit at the texels moved by the jitter, so the pair is taken at the
 *  point less that move (`low`): at the display's size, where the point falls on a texel centre,
 *  the box still holds the texels on both sides of it. Read again after the 3×3 — the cache's
 *  texels —, in its row order, so its box holds no registers through the loop. */
const ringStatement = (read: TexelReads) => ` for(var j=0;j<4;j++){
  let ring=${read.color('clampToExtent(low+vec2i(j&1,j>>1),size)')};
  ringLo=min(ringLo,ring);ringHi=max(ringHi,ring);
 }
`

/**
 * The temporal resolve, the one program of every render scale — a frame drawn at the display's
 * size is the ratio one of it (depth dilation, reconstruction and a YCoCg history box, folded into
 * the one pass): it runs per DISPLAY pixel, history at display size, the current image, depth,
 * identifiers and flags at render size (`view.render`). The display pixel's place in the render
 * grid is `r = uv · render − 0.5`, texel centres at integers. One loop over the 3×3 render texels
 * around it:
 * - depth dilation: the nearest surface (reversed depth: the greatest) gives the depth and the
 *   texel whose identifier reprojects, so a moving edge carries its own motion;
 * - each texel's sample, at the distance from where this frame sampled it — its centre moved by
 *   the jitter, in render pixels — to `r`, weighed twice in the one tap: by Lanczos-2 in render
 *   pixels, the reconstruction of the image (clamped to the 2×2 texels whose samples bracket the
 *   point, since Lanczos's negative lobes ring), and by the Blackman-Harris window of one DISPLAY
 *   pixel (`BLACKMAN_HARRIS_WGSL`), the weight the sample brings the display pixel's history;
 * - the YCoCg box history is clamped to.
 * The current value and its weight follow the history's resampling, `resampled` (`view.jitter.z`,
 * the history rebuilt from a changed image): unresampled, the samples' weighted mean and their
 * window total — the phases then rebuild the display size's detail, where a render-pixel kernel
 * would soften it —; resampled, the reconstruction and its `reach`, the Lanczos-2 weight of the
 * nearest sample at its distance in display pixels, so a sample that fell far does not overwrite
 * its history. Reprojection starts from the unjittered display-pixel centre at the dilated depth;
 * the blend is `taaHistoryBlend`, the tag written the dilated texel's. The as-is share and the
 * display layers (`layers.ts`) follow the reconstruction's weights.
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
 let low=vec2i(floor(-sampled));
 let nearest=closestSurface(clampToExtent(base,size),last);
 let nearDepth=nearest.depth;let depthSlack=nearest.slope;
 var sum=vec4f(0.0);var total=0.0;var closest=2.0;var blur=vec3f(0.0);
 var lo=vec4f(RANGE_BOUND);var hi=vec4f(-RANGE_BOUND);var ringLo=vec4f(RANGE_BOUND);var ringHi=vec4f(-RANGE_BOUND);
 let resampled=view.jitter.z;let toDisplay=view.viewport.x*view.render.z;
 var still=vec4f(0.0);var stillTotal=0.0;
${share(' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n')}${layerText(filtered, 'vars')} for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let tap=base+vec2i(dx,dy);
  let at=clampToExtent(tap,size);
  let sample=${read.color('at')};
  let gap=length(vec2f(at)+sampled);
  let weight=lanczos2(gap);closest=min(closest,gap);
  sum+=sample*weight;total+=weight;
  let hit=blackmanHarris(gap*toDisplay);still+=sample*hit;stillTotal+=hit;
  let y=vec4f(toYcocg(sample.rgb),sample.a);
  lo=min(lo,y);hi=max(hi,y);
${BLUR_TAP}${taaShareTap(asIs, read)}${layerText(filtered, 'tap')} }}
${ringStatement(read)} let rebuilt=clamp(sum/max(total,1e-4),ringLo,ringHi);
 // A display pixel no sample fell near this image takes the reconstruction as its mean.
 let mean=select(rebuilt,still/max(stillTotal,1e-30),stillTotal>0.0);
 var filtered=mix(mean,rebuilt,resampled);
${share(' share=clamp(share/max(total,1e-4),shareLo,shareHi);\n')}${layerText(filtered, 'scaled')} let centre=clampToExtent(base,size);
 let reach=saturate(lanczos2(closest*toDisplay));
 let sampleWeight=mix(stillTotal,reach,resampled);var count=sampleWeight;
 let nearId=nearest.id;let nearPage=pageOf(nearId);let geometry=vec2u(nearPage.identity,bitcast<u32>(nearDepth));
${MEASURES}
 if(view.params.y==0.0){return ${taaOut(asIs, filtered)};}
 let here=pixelPoint(coord,nearDepth);let before=pointBefore(here,nearId);let previous=previousProjected(before);
${taaHistoryBlend(asIs, filtered)}
}`,
    [taaPrelude(asIs, blended, filtered), LANCZOS2_WGSL, BLACKMAN_HARRIS_WGSL],
  )
}
