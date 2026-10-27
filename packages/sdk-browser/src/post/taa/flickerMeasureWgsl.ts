import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { colorSpacesWgsl, LUMA_TO_CHANNEL } from './colorSpaceWgsl.ts'
import { FLICKER_GHOSTING } from './flickerRates.ts'
import { LANE_ROWS, networkOf } from './rejectionNetworkWgsl.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import {
  annihilateWgsl,
  DISPLAY_STEP_ERROR_WGSL,
  FILTERING_WEIGHT,
  FLICKER_GATES_WGSL,
} from './rejectionShared.ts'
import { REPROJECTED_WORD_WGSL } from './reprojectWgsl.ts'
import type { RejectionTypes } from './rejectionTypes.ts'
import { THIN_MASK_BITS } from './thinGeometryWgsl.ts'
import type { Wave } from './waveOps.ts'

/** A gradient is kept in eight bits: what lies within this is its rounding. */
const GRADIENT_EPSILON = 1 / 127
/** The most flickers the history counts, within its eight bits. */
const FLICKER_COUNT_MAX = 20
/** The flicker luma's eight-bit rounding, which its modification measure discounts. */
const LUMA_STEP_ERROR = 0.5 / 255
/** A gradient past which a thin geometry region's flicker is one, however small. */
const THIN_GEOMETRY_GRADIENT = 0.00007

/** The inputs of the measure: the luma and its history, held onto each other and blurred. */
const inputsText = (t: RejectionTypes) => {
  const { F, V4, cast } = t
  return ` var lumas:Px;var prev:array<${V4},${LANE_ROWS}>;var modification:array<${F},${LANE_ROWS}>;var still:array<${F},${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){
  let c=pixel[r];
  let scene=opaque[r]*scale;
  // The flicker luma measured before the translucency, in the gamma space: squared to the measurement's.
  let measured=textureLoad(measuredLuma,c,0).r;
  let inputLuma=measured*measured;
  let change=dot(abs(linearToMeasure(scene)-linearToMeasure(composed[r]*scale)),vec3f(${wgslF32(1 / LUMA_TO_CHANNEL)}));
  modification[r]=${cast(F, `max(max(max(0.0,abs(inputLuma-measureLuma(scene))-${wgslF32(LUMA_STEP_ERROR)}),change),1.0-layers[r].a)`)};
  prev[r]=${cast(V4, 'textureLoad(flicker,c,0)')};
  still[r]=${cast(F, '1.0-f32(textureLoad(marks,c,0).b)/255.0')};
  lumas[r]=${V4}(${cast(F, 'inputLuma')},prev[r].x*prev[r].x,0.0,0.0);
 }
 // The input and the history each held onto the other, then blurred with the luma's modification.
 var swapped:Px;
 for(var r=0;r<${LANE_ROWS};r++){swapped[r]=lumas[r].yxzw;}
 let around=boxAndPlus3x3(lumas);
 let plus=around.plus;
 let crossed=annihilateToGuide(lumas,swapped,around.box);
 var held:Px;
 for(var r=0;r<${LANE_ROWS};r++){held[r]=${V4}(crossed[r].x,modification[r],crossed[r].y,0.0);}
 let filtered=blur3x3(held);
 var withHeld:Px;
 for(var r=0;r<${LANE_ROWS};r++){withHeld[r]=${V4}(filtered[r].x,held[r].x,filtered[r].z,0.0);}
 let box=minMax3x3(withHeld);
 var lo:array<${F},${LANE_ROWS}>;var hi:array<${F},${LANE_ROWS}>;var weight:array<${F},${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){lo[r]=box.lo[r].x;hi[r]=box.hi[r].x;weight[r]=select(0.0,relax[r],relaxing&&relax[r]>${wgslF32(1 / THIN_MASK_BITS.most)});}`
}

/** The measure's box, relaxed by the thin geometry, and the energy past it. */
const boxText = ({ F, V4 }: RejectionTypes) => ` if(relaxing){
  var kept:Px;
  for(var r=0;r<${LANE_ROWS};r++){
   lo[r]=lerpOf(lo[r],box.lo[r].z,weight[r]);hi[r]=lerpOf(hi[r],box.hi[r].z,weight[r]);
   kept[r]=${V4}(clamp(filtered[r].z,lo[r],hi[r]),0.0,0.0,0.0);
  }
  let keptBox=minMax3x3(kept);
  for(var r=0;r<${LANE_ROWS};r++){if(weight[r]>0.0){lo[r]=keptBox.lo[r].x;hi[r]=keptBox.hi[r].x;}}
 }
 // In the responsive mode the clamp error follows the blur of the lesser total variation of the input's change and of the input. The mode is the
 // uniform's, so the branch is taken by the whole workgroup together, the network's barriers inside it.
 var variation:array<${F},${LANE_ROWS}>;
 if(shadingResponsive()){
  var pair:Px;
  for(var r=0;r<${LANE_ROWS};r++){pair[r]=${V4}(abs(lumas[r].x-crossed[r].x),crossed[r].x,0.0,0.0);}
  let total=totalVariation3x3(pair);
  var least:Px;
  for(var r=0;r<${LANE_ROWS};r++){least[r]=${V4}(min(abs(total[r].x),abs(total[r].y)),0.0,0.0,0.0);}
  let blurred=blur3x3(least);
  for(var r=0;r<${LANE_ROWS};r++){variation[r]=blurred[r].x;}
 }
 var energy:Px;var delta:array<${F},${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){
  let boxSize=box.hi[r].y-box.lo[r].y;
  let clampError=max(max(Q,variation[r]),boxSize*${wgslF32(FILTERING_WEIGHT * 0.25)})+Q;
  let past=filtered[r].z;
  let clamped=clamp(past,lo[r]-clampError,hi[r]+clampError);
  delta[r]=max(abs(filtered[r].x-past),boxSize*${wgslF32(FILTERING_WEIGHT)}+Q*${wgslF32(2 * FILTERING_WEIGHT)});
  let e=abs(clamped-past);
  energy[r]=${V4}(e,saturate(1.0-max(e,0.0)*(1.0/delta[r])),0.0,0.0);
 }
 let spread=minMax3x3(median3x3(energy));`

/** The history update replayed on the luma, what of its gradient is a flicker, and the outputs: the
 *  flicker history of the texels the workgroup writes, and the error and count of every texel of
 *  its tile. */
const replayText = ({ F, V4, rcp, cast }: RejectionTypes) => {
  const G = wgslF32(FLICKER_GHOSTING)
  return ` // The history update replayed on the luma, and what of its gradient is a flicker.
 var swing:Px;var history:array<${F},${LANE_ROWS}>;var gradient:array<${F},${LANE_ROWS}>;var prevGradient:array<${F},${LANE_ROWS}>;
 var flickered:array<${F},${LANE_ROWS}>;var thinRegion:array<bool,${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){
  let clampBlend=spread.lo[r].y;
  let blendFinal=saturate(1.0-max(spread.hi[r].x,0.0)*(1.0/delta[r]));
  let input=lumas[r].x;let past=lumas[r].y;
  let pastKept=lerpOf(clamp(past,plus.lo[r].x,plus.hi[r].x),past,clampBlend);
  let taken=max(1.0-blendFinal,${G});
  let blended=input*taken-pastKept*(taken-1.0);
  let ghost=input*${G}-past*${wgslF32(FLICKER_GHOSTING - 1)};
  var g=blended-ghost;
  history[r]=sqrt(blended);
  g=sign(g)*max(abs(g)-filtered[r].y,0.0);
  let pg=prev[r].y*${wgslF32(255 / 127)}-1.0;
  var within=abs(g)<${wgslF32(GRADIENT_EPSILON)}||abs(pg)<${wgslF32(GRADIENT_EPSILON)};
  thinRegion[r]=false;
  if(relaxing){
   thinRegion[r]=weight[r]>0.0&&(abs(g)>${wgslF32(THIN_GEOMETRY_GRADIENT)}||abs(pg)>${wgslF32(THIN_GEOMETRY_GRADIENT)})&&within;
   within=within&&!thinRegion[r];
  }
  flickered[r]=select(${F}(1.0),${F}(0.0),g*pg>0.0||within||view.params.x!=0.0);
  gradient[r]=g;prevGradient[r]=pg;
  swing[r]=${V4}(min(abs(pg),abs(g))*flickered[r],flickered[r],0.0,0.0);
 }
 let spreadSwing=max3x3(max3x3(swing));
 var out:Flicker;
 for(var r=0;r<${LANE_ROWS};r++){
  var newGradient=prevGradient[r]*${wgslF32(FLICKER_GHOSTING - 1)}*(flickered[r]-1.0)+gradient[r];
  var total=prev[r].z*${wgslF32(1 - FLICKER_GHOSTING)}*still[r]+spreadSwing[r].x;
  var count=prev[r].w*${wgslF32(FLICKER_COUNT_MAX * (1 - FLICKER_GHOSTING))}*still[r]+spreadSwing[r].y;
  if(isRestarted(word[r])){newGradient=0.0;total=0.0;count=0.0;}
  let kept=floor(count*${wgslF32(255 / FLICKER_COUNT_MAX)})*${wgslF32(FLICKER_COUNT_MAX / 255)};
  total=total*kept*${rcp}(count);
  let fade=saturate(count*${cast(F, 'select(view.preExposure.z,view.preExposure.w,thinRegion[r])')}-0.5);
  let error=(abs(total*${rcp}(count))+count*${wgslF32(GRADIENT_EPSILON)})*fade;
  out.error[r]=saturate(error*still[r]-modification[r]);
  out.count[r]=kept/${FLICKER_COUNT_MAX}.0;
  if(writes[r]){textureStore(flickerOut,place[r],vec4f(${V4}(history[r],newGradient*${wgslF32(127 / 255)}+${wgslF32(127 / 255)},total,out.count[r])));}
 }
 return out;
}`
}

/**
 * THE FLICKER MEASURE, the first stage of the shading rejection's entry (`rejectionWgsl.ts`), over its
 * tile and its network (`rejectionNetworkWgsl.ts`), as the reference runs it: run only where the level
 * rejects by it (`view.quality.x`) or an analysis view is shown (`flickerMeasured`), else the
 * rejection's flicker error is none. The flicker luma measured on the scene before the translucency, in
 * eight bits (`measureFlickerLumaShader`, `flickerLumaWgsl.ts`), how far the translucency and the
 * rounding modified it — against the scene the composed image held before its layers
 * (`beforeLayers`) —, and the reprojected flicker history; the rejection's heuristic on that one
 * channel — the input and the history each held onto the other, blurred, the box — relaxed toward
 * the history by the thin geometry's weight —, the clamp error (in the responsive mode widened by the blur of the lesser total
 * variation of the input's change and of the input), the energy past it against the delta,
 * its median then its maximum and minimum —; the history update replayed on it and its gradient,
 * less the luma's modification, against a ghosting update (`FLICKER_GHOSTING`); a flicker where the
 * gradient and the accumulated one have opposite signs past their rounding — or in a thin geometry
 * region, any gradient —, never across a cut; its swing and its count spread by their 3×3 maxima
 * twice, added to the history's faded totals (none where the texel moves or is disoccluded); the
 * error, the mean swing plus the count's rounding, faded in over the flicker period, kept to still
 * texels less the luma's modification.
 * It takes the lanes' texels as the rejection loaded them (`pixel` the texel read, `place` the one
 * written, `writes` whether this workgroup writes it, the reprojection `word`, the scene colour
 * `opaque` before the translucency's layers and `composed` after, the `layers`), the thin geometry's
 * relaxation, and returns the error and the count of each texel of the tile — the ones it only
 * reads too —, writing the flicker history of the texels the workgroup writes.
 */
export const flickerMeasureWgsl = (t: RejectionTypes, wave?: Wave) => {
  const { F, S } = t
  return wgslBlock(
    `FLICKER_MEASURE${S}_WGSL`,
    [
      ...networkOf(t, wave),
      annihilateWgsl(t, wave),
      colorSpacesWgsl(t),
      safeRcp,
      TAA_VIEW_WGSL,
      FLICKER_GATES_WGSL,
      REPROJECTED_WORD_WGSL,
      DISPLAY_STEP_ERROR_WGSL,
    ],
    `struct Flicker{error:array<${F},${LANE_ROWS}>,count:array<${F},${LANE_ROWS}>}
fn measureFlicker(pixel:array<vec2i,${LANE_ROWS}>,place:array<vec2i,${LANE_ROWS}>,writes:array<bool,${LANE_ROWS}>,word:array<u32,${LANE_ROWS}>,opaque:array<vec3f,${LANE_ROWS}>,composed:array<vec3f,${LANE_ROWS}>,layers:array<vec4f,${LANE_ROWS}>,relax:array<${F},${LANE_ROWS}>,relaxing:bool,scale:f32)->Flicker{
${[inputsText(t), boxText(t), replayText(t)].join('\n')}`,
  )
}
