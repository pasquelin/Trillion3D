import { taaPrelude, taaShareTap, texelReads } from './shaderWgsl.ts'
import { TAA_WINDOW_WGSL } from './filterWeights.ts'
import { layerText, taaOut } from './layers.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { LARGEST_SCENE_COLOR, LARGEST_SMALL_FLOAT, quantizationError } from './colorSpaceWgsl.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'
import { FIRST_ANALYSIS_VIEW } from './rejectionWgsl.ts'
import { SHARE_CODE_SHIFT } from './velocityWgsl.ts'
import { HISTORY_GIVEN_UP_WGSL } from '../../visibility/types.ts'

/** The diagnostic view of the most of its history each pixel's material keeps — its opaque
 *  surface's or, at their coverage, its transparents' (`materialShare`) —
 *  (`taa-material-history`, `../../visibility/shader/shadeMode.ts`), as grey — white the whole
 *  history, black none —, after the analysis views. */
const MATERIAL_HISTORY_VIEW = FIRST_ANALYSIS_VIEW + 5

/** The history colour's relative rounding step (`HDR_FORMAT`, the colour of `HISTORY_FORMATS`):
 *  its stochastic rounding's. */
const HISTORY_MANTISSA_ERROR = quantizationError(HDR_FORMAT)

/**
 * The kernel of the current image around render texel `k`, the display pixel's centre `ko` off it
 * in render pixels: five samples — `k`, its neighbours toward the pixel on each axis, and, where
 * the level moves the far neighbour (`view.quality.z`), for each axis the corner toward the pixel
 * where the pixel lies a quarter texel or more off `k` on it, else that axis' far neighbour, the
 * corner counted once; else each axis' far neighbour, a plus. Each weighs its spatial weight at its offset
 * `d − ko` at the footprint `factor` (`taaWindow`, a minimal contribution of 0.005) times its tone
 * weight; the five's box is the clamp box. Every sample is held below the largest small float, as
 * the stored history is; the as-is share and the display layers follow the colour's weights, their
 * boxes the five's.
 */
const kernelText = (asIs: boolean, blended: boolean, filtered: boolean) => {
  const read = texelReads(blended)
  return ` var sum=vec4f(0.0);var total=0.0;var lo=vec4f(RANGE_BOUND);var hi=vec4f(-RANGE_BOUND);
${asIs ? ' var share=0.0;var shareLo=1.0;var shareHi=0.0;\n' : ''}${layerText(filtered, 'vars')} let side=select(vec2i(1),vec2i(-1),ko<vec2f(0.0));let square=abs(ko)>=vec2f(0.25);
 let footprint=factor*factor;let inputMost=${wgslF32(LARGEST_SMALL_FLOAT)}/exposure;let movesFar=view.quality.z!=0.0;
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let d=vec2i(dx,dy);
  let zero=d==vec2i(0);let near=d==side;let far=d==-side;
  let plusFar=(far.x&&zero.y)||(zero.x&&far.y);
  let movedFar=(all(near)&&any(square))||(far.x&&zero.y&&!square.x)||(zero.x&&far.y&&!square.y);
  let picked=all(zero)||(near.x&&zero.y)||(zero.x&&near.y)||select(plusFar,movedFar,movesFar);
  if(!picked){continue;}
  let at=clampTexel(k+d);
  let sample=min(${read.color('at')},vec4f(inputMost));
  let offset=vec2f(d)-ko;
  let weight=taaWindow(dot(offset,offset)*footprint)*toneWeight(sample.rgb*exposure);
  sum+=sample*weight;total+=weight;lo=min(lo,sample);hi=max(hi,sample);
${taaShareTap(asIs, read)}${layerText(filtered, 'tap')} }}
 let filtered=min(sum/total,vec4f(${wgslF32(LARGEST_SCENE_COLOR)})/exposure);
${asIs ? ' share=clamp(share/max(total,1e-4),shareLo,shareHi);\n' : ''}${layerText(filtered, 'scaled')}`
}

/** A diagnostic view's output in place of the colour (`view.params.w`): the image received at the
 *  render texel `at` the display pixel falls in, held below the largest small float as the kernel
 *  holds its samples (1); the rejection the blend applies, white the history kept (2); the validity
 *  written (3); from `FIRST_ANALYSIS_VIEW`, the analysis view the rejection's words hold, raw
 *  (`rejectionWgsl.ts`); the most of its history the pixel's material keeps, as grey
 *  (`MATERIAL_HISTORY_VIEW`). */
const viewText = (blended: boolean) => ` let shown=u32(view.params.w);
 if(shown==1u){color=min(${texelReads(blended).color('at')},vec4f(inputMost));}
 else if(shown==2u){color=vec4f(vec3f(1.0-minRejection),1.0);}
 else if(shown==3u){color=vec4f(vec3f(validity),1.0);}
 else if(shown==${MATERIAL_HISTORY_VIEW}u){color=vec4f(vec3f(materialShare),1.0);}
 else if(shown>=${FIRST_ANALYSIS_VIEW}u){color=vec4f(rejected.rgb,1.0);}
`

/**
 * The history update, per DISPLAY pixel, the one program of every render scale — a frame drawn at
 * the display's size is the ratio one of it: the history at display size, the current image and the
 * render-resolution analysis at render size (`view.render`).
 *
 * The display pixel's centre falls at `ppco = uv · render + jitter` in the jittered render grid, in
 * pixel coordinates; the render texel it lies in gives the analysis it reads: the reprojection
 * vector (hole-filled, `reprojectWgsl.ts`), the shading rejection — the low frequency rejection, how
 * far the clamp is lifted, how far the validity drops, the bits (`rejectionWgsl.ts`) — and the
 * spatial anti-aliaser's offset and noise filtering (`spatialAntiAliasingWgsl.ts`). The history is
 * read at `screen − vector`, off screen on a cut or past the screen's edge, disoccluded where the
 * shading analysis found the parallax disocclusion; it is not read where it is wholly rejected or
 * off screen.
 *
 * The kernel centre moves by the anti-aliaser's offset as far as the history is rejected
 * (`saturate(1 − 4·rejection)`, in full off screen or disoccluded). The weights, in whole
 * histories (`HISTORY_HYSTERESIS` an image of full alignment, `HISTORY_LAWS`): the image's is its nearest texel's
 * alignment at the kernel's alignment scale; the history's, the image's weight (the coarse
 * alignment's where it has none) times `(1 − b) / b` of the rejection's blend factor, at most the
 * history's validity — clamped by the validity drop (`REJECTED_VALIDITY_DROP`) — and the whole less
 * the image's. The kernel refines — its footprint a display pixel, its alignment at the display's
 * scale — as far as the rejection passes 13/16 (`saturate(16·r − 13)`) where the history refines:
 * its weight when refining is no less than when rejecting, and it holds a sample; elsewhere a render
 * pixel, softened by the noise filtering.
 *
 * The history is clamped to the kernel's box and lifted back toward itself as far as the rejection
 * lifts the clamp, each by its tone weight; its weight is then held below
 * `1 − MOVING_VALIDITY_DROP · speed` of its motion, unless the image and the history's lumas differ
 * by more — a contrasted edge keeps its weight, so it stays stable. The image and the history are
 * blended by their weights times their tone weights — where the history is read and not
 * disoccluded, the history's share of the weights is capped by the most its material keeps
 * (`materialShare`: the least of the opaque surface's, the rejection's `SHARE_CODE_SHIFT` bits in
 * twelfths, and what its transparents leave, the complement of the history they give up at the
 * render texel, `givenUp`, `GIVEN_UP_TARGET`): past it, the weights
 * become that share and its complement of their sum; 0.75, a responsive material, the current
 * image weighing at least a quarter; 0 the current filtered image alone —; the validity, the
 * weights' sum, is kept in eight bits,
 * rounded up; the colour is rounded stochastically to its half floats and held within the largest
 * small float.
 *
 * A diagnostic view of the pass (`view.params.w`, `taa` of `LIT_VIEWS`,
 * `../../visibility/shader/shadeMode.ts`) outputs, in place of the colour, the image it receives at
 * the render texel the display pixel falls in (1), the rejection the blend applies — the history's
 * share, `1 − minRejection`, as grey (2) —, the validity written (3), or an analysis view, the
 * factors that can take a texel's history away (4 to 8, `FIRST_ANALYSIS_VIEW`), or the most of its
 * history each pixel's material keeps, as grey (9, `MATERIAL_HISTORY_VIEW`); the analysis — and
 * up to 3 the weights and the share target — are those of the beauty image, the colour history
 * then holds that output, dropped when the view changes. Off, a uniform branch never taken.
 *
 * Per pixel: one vector, one rejection, one anti-aliaser and one given-up load, the history's five
 * Catmull-Rom taps of colour and share target, the kernel's five colour loads.
 */
export const taaResolveShader = (asIs: boolean, blended = false, filtered = false) =>
  wgslProgram(
    `@fragment fn resolve(@builtin(position) pixel:vec4f)->TaaOut{
 let exposure=view.exposure.x;
 let uv=pixel.xy*view.viewport.zw;
 let screen=uvToNdc(uv);
 var ppco=uv*view.render.xy+vec2f(view.jitter.x,-view.jitter.y);
 let at=clampTexel(vec2i(ppco));
 let vector=decodeVector(textureLoad(vectors,at,0).r);
 let rejected=textureLoad(rejection,at,0);
 let antiAliased=textureLoad(antiAliasing,at,0).rg;
 let prevScreen=screen-vector;
 // The display pixels it slid since the last image: half the screen vector's span per pixel.
 let speed=length(vector*view.viewport.xy*0.5);
 let lowFrequency=rejected.r;let clampLift=rejected.g;let validityDrop=rejected.b;
 let bits=u32(round(rejected.a*255.0));
 let offScreen=view.params.x!=0.0||max(abs(prevScreen.x),abs(prevScreen.y))>=1.0;
 let disoccluded=!offScreen&&(bits&1u)==0u;
 let noise=f32(antiAliased.y)/255.0;
 let prevUv=clamp(ndcToUv(prevScreen),0.5*view.viewport.zw,vec2f(1.0)-0.5*view.viewport.zw);
 var past=TaaPast(vec4f(0.0),vec4f(0.0));
 let pastRead=!(lowFrequency<=0.0||offScreen);
 if(pastRead){past=historyRead(prevUv);}
 let materialShare=min(1.0-historyGivenUp(bits>>${SHARE_CODE_SHIFT}u),1.0-textureLoad(givenUp,at,0).r);
 let shiftShare=select(saturate(1.0-lowFrequency*4.0),1.0,offScreen||disoccluded);
 ppco+=decodeAntiAliasOffset(antiAliased.x)*shiftShare;
 let k=clampTexel(vec2i(ppco));
 let ko=ppco-(floor(ppco)+0.5);
 let ratio=view.viewport.x*view.render.z;
 let d2=dot(ko,ko);
 let minRejection=select(1.0-min(lowFrequency,1.0),1.0,offScreen);
 let coarseCurrent=taaAlignment(d2)*HISTORY_HYSTERESIS;
 let idealCurrent=taaAlignment(d2*ratio*ratio)*HISTORY_HYSTERESIS;
 let held=min(past.tag.g,1.0-REJECTED_VALIDITY_DROP*validityDrop);
 let refiningShare=select(1.0,idealCurrent/(held+idealCurrent),held+idealCurrent>0.0);
 let rejectedPrev=min(coarseCurrent*prevMultiplier(minRejection),1.0);
 let refiningPrev=min(coarseCurrent*prevMultiplier(refiningShare),1.0);
 let refining=min(select(1.0,0.0,rejectedPrev<refiningPrev),saturate(held*HISTORY_SAMPLES));
 let kernelLerp=select(saturate(lowFrequency*16.0-13.0)*refining,0.0,offScreen||disoccluded);
 let factor=mix(1.0-0.5*noise,ratio,kernelLerp);
 let align=mix(1.0,ratio,kernelLerp);
 let currentWeight=taaAlignment(d2*align*align)*HISTORY_HYSTERESIS;
 var prevWeight=min(select(coarseCurrent,currentWeight,currentWeight>0.0)*prevMultiplier(minRejection),held);
 prevWeight=min(prevWeight,1.0-currentWeight);
${kernelText(asIs, blended, filtered)} let clamped=clamp(past.color,lo,hi);
 let boxed=(1.0-clampLift)*toneWeight(clamped.rgb*exposure);let lifted=clampLift*toneWeight(past.color.rgb*exposure);
 let liftScale=safeRcp(boxed+lifted);
 let blended=clamped*(boxed*liftScale)+past.color*(lifted*liftScale);
 let prevLuma=luma4(blended.rgb*exposure);let nowLuma=luma4(filtered.rgb*exposure);
 let stable=abs(nowLuma-prevLuma)/max(max(nowLuma,prevLuma),1e-30);
 prevWeight=min(prevWeight,max(1.0-MOVING_VALIDITY_DROP*saturate(speed*MOVING_SPEED_INVERSE),stable));
 let validity=ceil(255.0*(currentWeight+prevWeight))/255.0;
 let weights=prevWeight+currentWeight;
 let capped=pastRead&&!disoccluded&&prevWeight>materialShare*weights;
 let shares=select(vec2f(prevWeight,currentWeight),vec2f(materialShare,1.0-materialShare)*weights,capped);
 let wh=shares.x*toneWeightOfLuma4(prevLuma);let wc=shares.y*toneWeightOfLuma4(nowLuma);
 let blendScale=safeRcp(wh+wc);
 var color=blended*(wh*blendScale)+filtered*(wc*blendScale);
 let random=frameRandom(vec2i(pixel.xy),u32(view.jitter.w)).x;
 color=vec4f(clamp(ditherFloat(color.rgb,random,${wgslF32(HISTORY_MANTISSA_ERROR)}),vec3f(0.0),vec3f(${wgslF32(LARGEST_SMALL_FLOAT)}/exposure)),color.a);
${viewText(blended)}${asIs ? ' let keptShare=clamp(past.tag.r,shareLo,shareHi);\n' : ''}${layerText(filtered, 'kept')} return ${taaOut(asIs, filtered)};
}`,
    [taaPrelude(asIs, blended, filtered), TAA_WINDOW_WGSL, TILE_CLAMP_WGSL, HISTORY_GIVEN_UP_WGSL],
  )
