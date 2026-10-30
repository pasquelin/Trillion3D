import { taaPrelude } from './shaderWgsl.ts'
import { taaWindowWgsl } from './filterWeights.ts'
import { layerText, taaStores } from './layers.ts'
import { HALF_MAX, MAX_10_BIT_FLOAT } from '../../../../math/src/constants.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  FULL_PRECISION,
  LARGEST_SCENE_COLOR,
  quantizationErrorsOf,
  type Precision,
} from './colorSpaceWgsl.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import type { Wave } from './waveOps.ts'
import { ANTI_ALIAS_NEUTRAL } from './spatialAntiAliasingWgsl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'
import { FIRST_ANALYSIS_VIEW } from './rejectionShared.ts'
import { REJECTION_BITS } from './rejectionBits.ts'
import { REPROJECTION_FIELD_WGSL } from './reprojectionFieldWgsl.ts'

/**
 * The kernel of the current image around render texel `k`, the display pixel's centre `ko` off it
 * in render pixels: five samples — `k`, its neighbours toward the pixel on each axis, and, where
 * the level moves the far neighbour (`view.quality.z`), for each axis the corner toward the pixel
 * where the pixel lies a quarter texel or more off `k` on it, else that axis' far neighbour, the
 * corner counted once; else each axis' far neighbour, a plus. Each weighs its spatial weight at its offset
 * `d − ko` at the footprint `factor` (`taaWindow`, a minimal contribution of 0.005) times its tone
 * weight; the five's box is the clamp box. Every sample is held below the largest small float, as
 * the stored history is; the display layers follow the colour's weights, their boxes the five's.
 */
const kernelText = (filtered: boolean, p: Precision) => {
  const { F, V2, V4, S } = p
  const bound = S ? `${wgslF32(HALF_MAX)}` : 'RANGE_BOUND'
  return ` var sum=${V4}(0.0);var total=${F}(0.0);var lo=${V4}(${bound});var hi=${V4}(-${bound});
${layerText(filtered, 'vars', V4)} let side=select(vec2i(1),vec2i(-1),ko<${V2}(0.0));let square=abs(ko)>=${V2}(0.25);
 let footprint=factor*factor;let inputMost=${wgslF32(MAX_10_BIT_FLOAT)};let movesFar=view.quality.z!=0.0;
 for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
  let d=vec2i(dx,dy);
  let zero=d==vec2i(0);let near=d==side;let far=d==-side;
  let plusFar=(far.x&&zero.y)||(zero.x&&far.y);
  let movedFar=(all(near)&&any(square))||(far.x&&zero.y&&!square.x)||(zero.x&&far.y&&!square.y);
  let picked=all(zero)||(near.x&&zero.y)||(zero.x&&near.y)||select(plusFar,movedFar,movesFar);
  if(!picked){continue;}
  let at=clampTexel(k+d);
  let sample=${V4}(min(sceneColorAt(at),vec4f(inputMost)));
  let offset=${V2}(d)-ko;
  let weight=taaWindow${S}(dot(offset,offset)*footprint)*toneWeight${S}(sample.rgb);
  sum+=sample*weight;total+=weight;lo=min(lo,sample);hi=max(hi,sample);
${layerText(filtered, 'tap', V4)} }}
 let filtered=min(sum/total,${V4}(${F}(min(${wgslF32(LARGEST_SCENE_COLOR)},${wgslF32(HALF_MAX)}))));
${layerText(filtered, 'scaled', V4)}`
}

/** A diagnostic view's output in place of the colour (`view.params.w`): the image received at the
 *  render texel `at` the display pixel falls in, held below the largest small float as the kernel
 *  holds its samples (1); the rejection the blend applies, white the history kept (2); the validity
 *  written (3); from `FIRST_ANALYSIS_VIEW`, the analysis view the rejection's words hold, raw
 *  (`rejectionWgsl.ts`). */
const viewText = ({ V3, V4 }: Precision) => ` let shown=u32(view.params.w);
 if(shown==1u){color=${V4}(min(sceneColorAt(at),vec4f(inputMost)));}
 else if(shown==2u){color=${V4}(${V3}(1.0-minRejection),1.0);}
 else if(shown==3u){color=${V4}(${V3}(validity),1.0);}
 else if(shown>=${FIRST_ANALYSIS_VIEW}u){color=${V4}(${V3}(rejected.rgb),1.0);}
`

/** The texels a workgroup of the update covers across: 8, the lanes' places in a tile (`lanePixel`). */
const UPDATE_TILE_ACROSS = 8
/** The lanes of a workgroup: a wave program's subgroup, else 64 for the 32-bit program and 32 for
 *  the 16-bit one, which takes two pixels a lane. */
const lanesOf = (wave: Wave | undefined, pixels: number) => wave?.lanes ?? 64 / pixels
/** The rows a lane's first pixel covers in its tile: its lanes over 8; a 16-bit program's second
 *  pixel lies as many rows below. */
const tileDown = (wave: Wave | undefined, pixels: number) =>
  lanesOf(wave, pixels) / UPDATE_TILE_ACROSS

/**
 * The place of lane `t` in its tile, `x` across and `y` down: the lowest bit of `t` is the lowest of
 * `x`, the next the lowest of `y`, the two after the others of `x`, then those of `y` — the lanes
 * whose places differ by one pixel across or down are the lanes that differ in one of their lowest
 * four bits, so the 2×2 of a half-size texel is four lanes of consecutive places, and its mean two
 * exchanges (`halfText`). A tile of 32 lanes is 8 across and 4 down, one of 16 lanes 8 and 2.
 */
const LANE_PIXEL = `fn lanePixel(t:u32)->vec2i{
 return vec2i(i32((t&1u)|((t>>1u)&6u)),i32(((t>>1u)&1u)|((t>>3u)&6u)));
}
`

/** What the update is made for beside its layers: the format of the validity it stores to, whether
 *  it writes the half-size image (`halfOut`), the wave variant it runs as (`Wave`), none the plain
 *  program. */
export interface UpdateOptions {
  validity?: GPUTextureFormat
  half?: boolean
  wave?: Wave
  /** The precision of its colours and weights: 16 bits takes two pixels a lane (`Precision`). */
  precision?: Precision
}

/** The entry of the update: the tile of the workgroup `wg`, the lane `lane` in it. A wave program
 *  fixes the subgroup it runs as — a workgroup of its lanes, its size pinned where the adapter
 *  runs others (`Wave.pinned`) — and takes its lane from the subgroup (`subgroup_invocation_id`);
 *  the plain one from the workgroup's index. */
const updateEntry = (wave: Wave | undefined, half: boolean, pixels: number) =>
  wave
    ? `enable subgroups;
${wave.pinned ? 'enable subgroup_size_control;\n' : ''}diagnostic(off,subgroup_uniformity);
@compute @workgroup_size(${wave.lanes})${wave.pinned ? ` @subgroup_size(${wave.lanes})` : ''}
fn resolve(@builtin(workgroup_id) wg:vec3u,@builtin(subgroup_invocation_id) lane:u32){`
    : `${half ? `var<workgroup> halfTile:array<vec4f,${lanesOf(wave, pixels)}>;\n` : ''}@compute @workgroup_size(${lanesOf(wave, pixels)})
fn resolve(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32){`

/**
 * The half-size image of the colour just stored: each texel the mean of the four pixels it covers,
 * written by the lane of the pixel at its top left. The colour is scaled by a quarter first, as
 * the pixels come to be added, then added to the lane's whose place differs in the lowest bit of
 * its lane (the pixel across) and, the sums added, in the next (the pixel down). A wave program
 * exchanges through the subgroup; the plain one through workgroup memory, a barrier between every
 * write and read of it, a lane reading what the four in its place wrote. The lanes of a tile
 * outside the history hold the colour their clamped reads made, as the lanes of the edge's.
 */
const halfText = (wave: Wave | undefined, { V4 }: Precision) => {
  // A value crosses lanes as 32-bit floats, which hold a half exactly; it is added in the precision.
  const exchange = (mask: number) =>
    wave
      ? `  mean+=${V4}(subgroupShuffleXor(vec4f(mean),${mask}u));\n`
      : `  halfTile[lane]=vec4f(mean);\n  workgroupBarrier();\n  mean+=${V4}(halfTile[lane^${mask}u]);\n  workgroupBarrier();\n`
  return `  var mean=color*0.25;
${exchange(1)}${exchange(2)}  let quad=hp>>vec2u(1u);
  if(((hp.x|hp.y)&1)==0&&all(quad<vec2i(textureDimensions(halfOut)))){textureStore(halfOut,quad,vec4f(mean));}
`
}

/** What the stages of the update's text share: the precision, the form of the program, the pixels a
 *  lane takes and the rows each covers in its tile. */
interface UpdateText {
  readonly p: Precision
  readonly filtered: boolean
  readonly historyFormat: GPUTextureFormat
  readonly wave: Wave | undefined
  readonly half: boolean
  readonly pixels: number
  readonly down: number
}

/** The entry and the history pixel a lane takes: its place, its uv and the render texel it falls in. */
const updateHeadText = ({ p, pixels, down, wave, half }: UpdateText) => {
  const { F, S } = p
  return `${LANE_PIXEL}${updateEntry(wave, half, pixels)}
 let ratio=view.viewport.x*view.render.z;let ratioP=${F}(ratio);
 for(var px=0;px<${pixels};px++){
 let hp=vec2i(wg.xy)*vec2i(${UPDATE_TILE_ACROSS},${down * pixels})+lanePixel(lane)+vec2i(0,px*${down});
 let pixel=vec2f(hp)+vec2f(0.5);
 let uv=pixel*view.viewport.zw;
 let screen=uvToNdc(uv);
 var ppco=uv*view.render.xy+vec2f(view.jitter.x,-view.jitter.y);
 let at=clampTexel(vec2i(ppco));
 // @cut head keep: if(f32(at.x)+f32(uv.x)+f32(screen.x)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}`
}

/** The texel the reprojection field's boundary sends the pixel to, and the pixel's place in it. */
const updateFieldText = ({ p }: UpdateText) => {
  const { V2 } = p
  return ` // The history pixel's place in its render texel, before the anti-aliaser moves the kernel.
 let ko0=${V2}(ppco-(floor(ppco)+0.5));
 let field=view.fraction.w!=0.0;
 var dilatedAt=at;
 var coordinate=ko0;
 if(field){
  let boundaryWord=textureLoad(boundary,at,0).r;
  if(boundaryWord!=NO_BOUNDARY_WORD){
   let offset=decodeReprojectionOffset(boundaryWord);
   let inside=historyWithinBoundary(vec2f(ko0),decodeReprojectionBoundary(boundaryWord),1.0/ratio);
   let applied=select(-offset,offset,inside);
   dilatedAt=clampTexel(at+applied);
   coordinate=ko0-${V2}(applied);
  }
 }
 // @cut field keep: if(f32(dilatedAt.x)+f32(dilatedAt.y)+f32(coordinate.x)+f32(coordinate.y)+f32(ko0.x)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}`
}

/** The analysis the pixel reads: its rejection, its vector, dilated and moved by the field, its anti-aliaser word. */
const updateAnalysisText = ({ p }: UpdateText) => {
  const { F, V2, V4 } = p
  return ` let rejected=${V4}(textureLoad(rejection,at,0));
 var lowFrequency=rejected.r;var clampLift=rejected.g;var validityDrop=rejected.b;
 var bits=u32(round(f32(rejected.a)*255.0));
 var vector=decodeVector(textureLoad(vectors,dilatedAt,0).r);
 var upscale=${F}(1.0);
 if(field){
  let dilated=${V4}(textureLoad(rejection,dilatedAt,0));
  lowFrequency=min(lowFrequency,dilated.r);clampLift=min(clampLift,dilated.g);validityDrop=max(validityDrop,dilated.b);
  bits=u32(round(f32(dilated.a)*255.0));
  // A hole-filled texel's jacobian was written zero by the reprojection.
  let jacobianHere=decodeReprojectionJacobian(textureLoad(jacobian,dilatedAt,0).r);
  let j0=${V2}(jacobianHere.j0);let j1=${V2}(jacobianHere.j1);
  vector+=screenVelocity(vec2f(coordinate.x*j0+coordinate.y*j1));
  upscale=${F}(1.0/reprojectionUpscale(TaaJacobian(vec2f(j0),vec2f(j1))));
 }
 var antiAliased=vec2u(${ANTI_ALIAS_NEUTRAL}u,0u);
 if(view.quality.y!=0.0){antiAliased=textureLoad(antiAliasing,at,0).rg;}
 // @cut analysis keep: if(f32(lowFrequency)+f32(clampLift)+f32(validityDrop)+f32(bits)+f32(vector.x)+f32(vector.y)+f32(upscale)+f32(antiAliased.x)+f32(antiAliased.y)+f32(dilatedAt.x)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}`
}

/** Where the history pixel was, whether it restarts, and the history read there. */
const updatePastText = ({ p }: UpdateText) => {
  const { F, V4, S } = p
  return ` let prevScreen=screen-vector;
 // The speed the weight clamp reads: the vector's span over the history's size, twice the history pixels slid.
 let speed=${F}(length(vector*view.viewport.xy));
 let offScreen=view.params.x!=0.0||max(abs(prevScreen.x),abs(prevScreen.y))>=1.0;
 let resurrected=(bits&${REJECTION_BITS.resurrected}u)!=0u;
 let disoccluded=!offScreen&&(bits&${REJECTION_BITS.kept}u)==0u;
 // A disoccluded pixel restarts its history, unless the frame it is resurrected from holds it.
 let restarts=offScreen||(disoccluded&&!resurrected);
 let noise=${F}(antiAliased.y)/255.0;
 let prevUv=clamp(ndcToUv(prevScreen),0.5*view.viewport.zw,vec2f(1.0)-0.5*view.viewport.zw);
 var past=TaaPast${S}(${V4}(0.0),${V4}(0.0));
 let pastRead=!(lowFrequency<=0.0||offScreen);
 if(pastRead){past=historyRead${S}(prevUv,resurrected);}
 // @cut past keep: if(f32(past.color.x)+f32(past.color.y)+f32(past.color.z)+f32(past.color.w)+f32(past.tag.x)+f32(speed)+f32(noise)+select(0.0,1.0,restarts)+select(0.0,1.0,disoccluded)+f32(lowFrequency)+f32(antiAliased.x)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}`
}

/** The kernel's centre, and the image's and the history's weights. */
const updateWeightsText = ({ p }: UpdateText) => {
  const { F, V2, S } = p
  return ` let shiftShare=select(saturate(1.0-lowFrequency*4.0),1.0,restarts);
 ppco+=vec2f(${V2}(decodeAntiAliasOffset(antiAliased.x))*shiftShare);
 let k=clampTexel(vec2i(ppco));
 let ko=${V2}(ppco-(floor(ppco)+0.5));
 let d2=dot(ko,ko);
 let hysteresis=${F}(historyHysteresis());
 let minRejection=select(1.0-min(lowFrequency,upscale),1.0,offScreen);
 let coarseCurrent=taaAlignment${S}(d2)*hysteresis;
 let idealCurrent=taaAlignment${S}(d2*ratioP*ratioP)*hysteresis;
 let held=min(past.tag.r,1.0-${F}(rejectedValidityDrop())*validityDrop);
 let refiningShare=select(1.0,idealCurrent/(held+idealCurrent),held+idealCurrent>0.0);
 let rejectedPrev=min(coarseCurrent*prevMultiplier${S}(minRejection),1.0);
 let refiningPrev=min(coarseCurrent*prevMultiplier${S}(refiningShare),1.0);
 let refining=min(select(${F}(1.0),${F}(0.0),rejectedPrev<refiningPrev),saturate(held*${F}(historySamples())));
 let kernelLerp=select(saturate(lowFrequency*16.0-13.0)*refining,0.0,restarts);
 let factor=mix(1.0-0.5*noise,ratioP,kernelLerp);
 let align=mix(${F}(1.0),ratioP,kernelLerp);
 let currentWeight=taaAlignment${S}(d2*align*align)*hysteresis;
 var prevWeight=min(select(coarseCurrent,currentWeight,currentWeight>0.0)*prevMultiplier${S}(minRejection),held);
 prevWeight=min(prevWeight,1.0-currentWeight);
 // @cut weights keep: if(f32(prevWeight)+f32(currentWeight)+f32(factor)+f32(minRejection)+f32(refining)+f32(held)+f32(ko.x)+f32(ko.y)+f32(k.x)+f32(k.y)+f32(past.color.x)+f32(past.tag.x)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}`
}

/** The kernel, the history held to its box, the validity, and the blend dithered to the history's format. */
const updateBlendText = ({ p, down, filtered, historyFormat }: UpdateText) => {
  const { F, V3, V4, S } = p
  return `${kernelText(filtered, p)}
 // @cut kernel keep: if(f32(filtered.x)+f32(filtered.y)+f32(filtered.z)+f32(lo.x)+f32(hi.y)+f32(total)+f32(past.color.x)+f32(past.tag.x)+f32(prevWeight)+f32(currentWeight)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}
 let clamped=clamp(past.color,lo,hi);
 let boxed=(1.0-clampLift)*toneWeight${S}(clamped.rgb);let lifted=clampLift*toneWeight${S}(past.color.rgb);
 let liftScale=safeRcp${S}(boxed+lifted);
 let blended=clamped*(boxed*liftScale)+past.color*(lifted*liftScale);
 let prevLuma=luma4${S}(blended.rgb);let nowLuma=luma4${S}(filtered.rgb);
 // Held from zero: WGSL leaves 0/0 indeterminate, where a black pixel's two lumas are both zero.
 let stable=abs(nowLuma-prevLuma)/max(max(nowLuma,prevLuma),${wgslF32(p.tiny)});
 prevWeight=min(prevWeight,max(1.0-${F}(movingValidityDrop())*saturate(speed*${F}(movingSpeedInverse())),stable));
 let validity=ceil(255.0*(currentWeight+prevWeight))/255.0;
 // @cut clamp keep: if(f32(blended.x)+f32(blended.y)+f32(blended.z)+f32(validity)+f32(prevWeight)+f32(currentWeight)+f32(stable)+f32(filtered.x)+f32(nowLuma)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}
 // The blend's weights in 32 bits, as the reference keeps them against extreme differences.
 let wh=f32(prevWeight*toneWeightOfLuma4${S}(prevLuma));let wc=f32(currentWeight*toneWeightOfLuma4${S}(nowLuma));
 let blendScale=safeRcp(wh+wc);
 let whScaled=${F}(wh*blendScale);let wcScaled=${F}(wc*blendScale);
 var color=blended*whScaled+filtered*wcScaled;
 // @cut blend keep: if(f32(color.x)+f32(color.y)+f32(color.z)+f32(color.w)+f32(validity)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}
 // One draw a lane, at its first pixel, for each pixel it takes.
 let random=${F}(frameRandom(hp-vec2i(0,px*${down}),u32(view.jitter.w)).x);
 color=${V4}(clamp(ditherFloat${S}(color.rgb,random,${V3}(${quantizationErrorsOf(historyFormat)})),${V3}(0.0),${V3}(${F}(min(${wgslF32(MAX_10_BIT_FLOAT)},${wgslF32(HALF_MAX)})))),color.a);
 // @cut dither keep: if(f32(color.x)+f32(color.y)+f32(color.z)+f32(color.w)+f32(validity)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}`
}

/** The diagnostic view's output, the layers, the stores of the frame and the half-size image. */
const updateStoreText = ({ p, filtered, wave, half }: UpdateText) => {
  const { V4 } = p
  return `${viewText(p)}${layerText(filtered, 'kept', V4)} if(all(hp<vec2i(textureDimensions(historyOut)))){
${taaStores(filtered)} }
 // @cut stored keep: if(f32(color.x)+f32(validity)<-1e30){textureStore(validityOut,hp,vec4f(1.0));}
${half ? halfText(wave, p) : ''} }
}`
}

/**
 * The history update, per HISTORY pixel, the one program of every render scale and every history
 * size — a frame drawn at the display's size and a history at the display's are the ratio one of
 * them: the history at its own size (`view.viewport`, the display's or twice it), the current image
 * and the render-resolution analysis at render size (`view.render`). A compute dispatch over the
 * history in tiles of 8 across (`lanePixel`): 64 lanes and 8 down for the plain program, a subgroup's
 * lanes and that over 8 down for a wave one. It stores the colour, the validity and the layers
 * to the frame it writes (`taaStores`), the pixels the history holds alone, and, with `half`, the
 * half-size image beside them (`halfText`).
 *
 * The history pixel's centre falls at `ppco = uv · render + jitter` in the jittered render grid, in
 * pixel coordinates; the render texel it lies in gives the analysis it reads: the reprojection
 * vector (hole-filled, `reprojectWgsl.ts`), the shading rejection — the low frequency rejection, how
 * far the clamp is lifted, how far the validity drops, the bits (`rejectionBits.ts`) — and the
 * spatial anti-aliaser's offset and noise filtering (`spatialAntiAliasingWgsl.ts`; none, the neutral
 * word, where the level runs no anti-aliaser, `view.quality.y`). Where the level
 * reprojects by the field (`view.fraction.w`, `reprojectionFieldWgsl.ts`), the vector is that of
 * the texel the boundary sends the history pixel to — the texel's own, or its neighbour's at the
 * dilating offset, by which side of the boundary the pixel lies —, moved by the pixel's coordinate
 * times the jacobian; the rejections are the least of the two texels' (the validity's drop the
 * most), the bits those of the neighbour's, and the history is read the less stretched the more the
 * jacobian stretches it. The history is read at `screen − vector`, off screen on a cut or past the
 * screen's edge, disoccluded where the shading analysis found the parallax disocclusion; it is not
 * read where it is wholly rejected or off screen. Where the texel's bits say the pixel is
 * resurrected (`REJECTION_BITS.resurrected`), the vector is the reprojection to the frame it is
 * resurrected from and the history that frame's, its light brought to this image's.
 *
 * The kernel centre moves by the anti-aliaser's offset as far as the history is rejected
 * (`saturate(1 − 4·rejection)`, in full off screen or disoccluded and not resurrected). The weights,
 * in whole histories (`historyHysteresis` an image of full alignment, `historySampleLaws`): the
 * image's is its nearest texel's alignment at the kernel's alignment scale; the history's, the
 * image's weight (the coarse alignment's where it has none) times `(1 − b) / b` of the rejection's
 * blend factor, at most the history's validity — clamped by the validity drop
 * (`rejectedValidityDrop`) — and the whole less the image's. The kernel refines — its footprint a
 * history pixel, its alignment at the history's scale — as far as the rejection passes 13/16
 * (`saturate(16·r − 13)`) where the history refines: its weight when refining is no less than when
 * rejecting, and it holds a sample; elsewhere a render pixel, softened by the noise filtering.
 *
 * The history is clamped to the kernel's box and lifted back toward itself as far as the rejection
 * lifts the clamp, each by its tone weight; its weight is then held below
 * `1 − movingValidityDrop · speed` of its motion, unless the image and the history's lumas differ
 * by more — a contrasted edge keeps its weight, so it stays stable. The image and the history are
 * blended by their weights times their tone weights; the validity, the weights' sum, is kept in
 * eight bits, rounded up; the colour is rounded stochastically to the format the history keeps it
 * in (`historyFormat`) and held within the largest small float. What a material asks of its
 * history is not read here: a pixel that restarts it reaches this pass disoccluded
 * (`REPROJECT_BITS.restarts`, `rejectionWgsl.ts`).
 *
 * A diagnostic view of the pass (`view.params.w`, `taa` of `LIT_VIEWS`,
 * `../../visibility/shader/shadeMode.ts`) outputs, in place of the colour, the image it receives at
 * the render texel the history pixel falls in (1), the rejection the blend applies — the history's
 * share, `1 − minRejection`, as grey (2) —, the validity written (3), or an analysis view, the
 * factors that can take a texel's history away, and the responsiveness each pixel carries (4 to 9,
 * `FIRST_ANALYSIS_VIEW`); the analysis — and
 * up to 3 the weights and the validity — are those of the beauty image, the colour history
 * then holds that output, dropped when the view changes. Off, a uniform branch never taken.
 *
 * Per pixel: one vector, one rejection and one anti-aliaser load, the field's three
 * more where it reprojects by it, the history's five Catmull-Rom taps of colour and validity,
 * the kernel's five colour loads.
 */
export const taaResolveShader = (
  filtered = false,
  historyFormat: GPUTextureFormat = HDR_FORMAT,
  { validity = 'rgba8unorm', half = false, wave, precision = FULL_PRECISION }: UpdateOptions = {},
) => {
  const p = precision
  const pixels = p.S ? 2 : 1
  const text: UpdateText = {
    p,
    filtered,
    historyFormat,
    wave,
    half,
    pixels,
    down: tileDown(wave, pixels),
  }
  return wgslProgram(
    [
      updateHeadText,
      updateFieldText,
      updateAnalysisText,
      updatePastText,
      updateWeightsText,
      updateBlendText,
      updateStoreText,
    ]
      .map((stage) => stage(text))
      .join('\n'),
    [
      ...p.enable,
      taaPrelude({ filtered, half, color: historyFormat, validity }, p),
      taaWindowWgsl(p),
      TILE_CLAMP_WGSL,
      REPROJECTION_FIELD_WGSL,
    ],
  )
}
