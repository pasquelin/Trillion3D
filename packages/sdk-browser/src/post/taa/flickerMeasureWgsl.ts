import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import {
  colorSpacesWgsl,
  FULL_PRECISION,
  HALF_PRECISION,
  LUMA_TO_CHANNEL,
} from './colorSpaceWgsl.ts'
import { FLICKER_CELL_WGSL, FLICKER_PLANES } from './flickerErrorCells.ts'
import { MEASURE_BYTE_WGSL } from './flickerLumaWgsl.ts'
import { FLICKER_GHOSTING } from './flickerRates.ts'
import {
  LANE_ROWS,
  networkOf,
  rejectionWaveOf,
  REJECT_SHADING_OVERSCAN,
  REJECT_SHADING_TILE,
} from './rejectionNetworkWgsl.ts'
import {
  annihilateWgsl,
  FILTERING_WEIGHT,
  FLICKER_GATES_WGSL,
  rejectionConstantsText,
  rejectionTypes,
  relaxationText,
  tileEntryText,
  type RejectionTypes,
} from './rejectionWgsl.ts'
import { FLICKER_FORMAT, REPROJECTED_WORD_WGSL } from './reprojectWgsl.ts'
import { THIN_MASK_BITS } from './thinGeometryWgsl.ts'
import { TRANSLUCENCY_WGSL } from './translucencyWgsl.ts'
import type { Wave } from './waveOps.ts'

/** The flicker measure's bindings. */
export const FLICKER_MEASURE_BINDINGS = {
  view: 0,
  current: 1,
  translucency: 2,
  word: 3,
  flicker: 4,
  marks: 5,
  thin: 6,
  measureLuma: 7,
  flickerOut: 8,
  flickerError: 9,
} as const

/** A gradient is kept in eight bits: what lies within this is its rounding. */
const GRADIENT_EPSILON = 1 / 127
/** The most flickers the history counts, within its eight bits. */
const FLICKER_COUNT_MAX = 20
/** The flicker luma's eight-bit rounding, which its modification measure discounts. */
const LUMA_STEP_ERROR = 0.5 / 255
/** A gradient past which a thin geometry region's flicker is one, however small. */
const THIN_GEOMETRY_GRADIENT = 0.00007

const bindingsText = () => {
  const B = FLICKER_MEASURE_BINDINGS
  return `@group(0) @binding(${B.view}) var<uniform> view:TaaView;
@group(0) @binding(${B.current}) var current:texture_2d<f32>;
@group(0) @binding(${B.translucency}) var translucency:texture_2d<f32>;
@group(0) @binding(${B.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${B.flicker}) var flicker:texture_2d<f32>;
@group(0) @binding(${B.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${B.thin}) var thin:texture_2d<f32>;
@group(0) @binding(${B.measureLuma}) var measuredLuma:texture_2d<f32>;
@group(0) @binding(${B.flickerOut}) var flickerOut:texture_storage_2d<${FLICKER_FORMAT},write>;
@group(0) @binding(${B.flickerError}) var<storage,read_write> flickerError:array<f32>;
${rejectionConstantsText()}`
}

/** The inputs of the measure: the luma and its history, held onto each other and blurred. */
const inputsText = (t: RejectionTypes) => {
  const { F, V4, cast } = t
  return ` var pixel:array<vec2i,${LANE_ROWS}>;var restarted:array<bool,${LANE_ROWS}>;var relax:array<${F},${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){pixel[r]=clamp(origin+vec2i(laneX,laneRow+r),vec2i(0),size-vec2i(1));}
${relaxationText(t)}
 var lumas:Px;var prev:array<${V4},${LANE_ROWS}>;var modification:array<${F},${LANE_ROWS}>;var still:array<${F},${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){
  let c=pixel[r];
  let raw=textureLoad(current,c,0).rgb;
  let layers=layersAt(c);
  let scene=beforeLayers(raw,layers)*scale;
  let composed=min(raw,vec3f(most));
  restarted[r]=isRestarted(textureLoad(reprojected,c,0).r);
  // The flicker luma measured before the translucency, in the gamma space: squared to the measurement's.
  let measured=textureLoad(measuredLuma,c,0).r;
  let inputLuma=measured*measured;
  let change=dot(abs(linearToMeasure(scene)-linearToMeasure(composed*scale)),vec3f(${wgslF32(1 / LUMA_TO_CHANNEL)}));
  modification[r]=${cast(F, `max(max(max(0.0,abs(inputLuma-measureLuma(scene))-${wgslF32(LUMA_STEP_ERROR)}),change),1.0-layers.a)`)};
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
 var energy:Px;var delta:array<${F},${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){
  let boxSize=box.hi[r].y-box.lo[r].y;
  let clampError=max(Q,boxSize*${wgslF32(FILTERING_WEIGHT * 0.25)})+Q;
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
  const tile = REJECT_SHADING_TILE
  const overscan = REJECT_SHADING_OVERSCAN
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
 for(var r=0;r<${LANE_ROWS};r++){
  var newGradient=prevGradient[r]*${wgslF32(FLICKER_GHOSTING - 1)}*(flickered[r]-1.0)+gradient[r];
  var total=prev[r].z*${wgslF32(1 - FLICKER_GHOSTING)}*still[r]+spreadSwing[r].x;
  var count=prev[r].w*${wgslF32(FLICKER_COUNT_MAX * (1 - FLICKER_GHOSTING))}*still[r]+spreadSwing[r].y;
  if(restarted[r]){newGradient=0.0;total=0.0;count=0.0;}
  let kept=floor(count*${wgslF32(255 / FLICKER_COUNT_MAX)})*${wgslF32(FLICKER_COUNT_MAX / 255)};
  total=total*kept*${rcp}(count);
  let fade=saturate(count*${cast(F, 'select(view.exposure.z,view.exposure.w,thinRegion[r])')}-0.5);
  let error=(abs(total*${rcp}(count))+count*${wgslF32(GRADIENT_EPSILON)})*fade;
  let cellError=saturate(error*still[r]-modification[r]);
  let cellCount=kept/${FLICKER_COUNT_MAX}.0;
  let t=vec2i(laneX,laneRow+r);let g=origin+t;
  if(all(t>=vec2i(${overscan}))&&all(t<vec2i(${tile - overscan}))&&all(g<size)){textureStore(flickerOut,g,vec4f(${V4}(history[r],newGradient*${wgslF32(127 / 255)}+${wgslF32(127 / 255)},total,cellCount)));}
  flickerError[flickerCell(wg,groups,laneRow+r,laneX,${FLICKER_PLANES.error}u)]=f32(cellError);
  if(analysisShown()){flickerError[flickerCell(wg,groups,laneRow+r,laneX,${FLICKER_PLANES.count}u)]=f32(cellCount);}
 }
}`
}

/**
 * THE FLICKER MEASURE, one workgroup per `REJECT_SHADING_STRIDE` square of render texels over the
 * shading rejection's tiles and network (`rejectionNetworkWgsl.ts`), a dispatch of its own before the
 * rejection's, so that neither keeps the other's arrays in its registers: run only where the level
 * rejects by it (`view.quality.x`) or an analysis view is shown, else `analysis.ts` leaves the
 * dispatch out (`AnalysisWork.flicker`) and the rejection reads none (`flickerMeasured`) — the
 * flicker luma measured on the scene before the translucency, in eight bits
 * (`measureFlickerLumaShader`, `flickerLumaWgsl.ts`), how far the translucency and the
 * rounding modified it — against the scene the composed image held before its layers
 * (`beforeLayers`) —, and the reprojected flicker history; the rejection's heuristic on that one
 * channel — the input and the history each held onto the other, blurred, the box — relaxed toward
 * the history by the thin geometry's weight —, the clamp error, the energy past it against the delta,
 * its median then its maximum and minimum —; the history update replayed on it and its gradient,
 * less the luma's modification, against a ghosting update (`FLICKER_GHOSTING`); a flicker where the
 * gradient and the accumulated one have opposite signs past their rounding — or in a thin geometry
 * region, any gradient —, never across a cut; its swing and its count spread by their 3×3 maxima
 * twice, added to the history's faded totals (none where the texel moves or is disoccluded); the
 * error, the mean swing plus the count's rounding, faded in over the flicker period, kept to still
 * texels less the luma's modification.
 * Written: the flicker history, for the texels the workgroup writes; and, for each texel of its tile
 * — the ones it only reads too, whose values are this tile's alone (`flickerErrorCells.ts`) — the
 * error and, in an analysis view, the count, in 32 bits whatever the precision, which the shading
 * rejection reads back as they were computed.
 * Run in the same precision and wave variant as the shading rejection (`half`, `runAs`).
 */
export const flickerMeasureShader = (half = false, runAs?: Wave) => {
  const p = half ? HALF_PRECISION : FULL_PRECISION
  const wave = rejectionWaveOf(runAs)
  const t = rejectionTypes(p)
  return wgslProgram(
    [
      bindingsText(),
      tileEntryText('measureFlicker', wave),
      inputsText(t),
      boxText(t),
      replayText(t),
    ].join('\n'),
    [
      ...p.enable,
      TAA_VIEW_WGSL,
      colorSpacesWgsl(p),
      MEASURE_BYTE_WGSL,
      FLICKER_CELL_WGSL,
      FLICKER_GATES_WGSL,
      REPROJECTED_WORD_WGSL,
      TRANSLUCENCY_WGSL,
      annihilateWgsl(p, wave),
      ...networkOf(p, wave),
      safeRcp,
    ],
  )
}
