import { MEASURE_BYTE_WGSL } from './flickerLumaWgsl.ts'
import {
  LANE_ROWS,
  networkOf,
  rejectionWaveOf,
  REJECT_SHADING_LANES,
  REJECT_SHADING_OVERSCAN,
  REJECT_SHADING_STRIDE,
  REJECT_SHADING_TILE,
} from './rejectionNetworkWgsl.ts'
import { ANTI_ALIAS_MASK, LDR_LUMA, storageDeclaration, type StorageForm } from './storageForms.ts'
import { HALF_MAX, MAX_10_BIT_FLOAT } from '../../../../math/src/constants.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { TAA_VIEW_WGSL, packedStorageWgsl } from './bindingsWgsl.ts'
import {
  colorSpacesWgsl,
  DISPLAY_STEP_ERROR,
  ditherWgsl,
  FULL_PRECISION,
  HALF_PRECISION,
  type Precision,
  LARGEST_SCENE_COLOR,
  LUMA_TO_CHANNEL,
  quantizationError,
  quantizationErrorsOf,
  sceneColorWgsl,
  sceneColorWords,
} from './colorSpaceWgsl.ts'
import { FLICKER_GHOSTING } from './flickerRates.ts'
import { REJECTION_BITS } from './rejectionBits.ts'
import { FIELD_FORMAT, FIELD_LAYERS } from './reprojectionFieldWgsl.ts'
import {
  FLICKER_FORMAT,
  GUIDE_LAYERS,
  REPROJECT_BITS,
  REPROJECTED_WORD_WGSL,
} from './reprojectWgsl.ts'
import { RESURRECTION_WGSL } from './resurrectionWgsl.ts'
import {
  antiAliasMaskWgsl,
  LUMA_601_WGSL,
  SPATIAL_ANTI_ALIASER_MIN_LUMINANCE,
} from './spatialAntiAliasingWgsl.ts'
import { THIN_COVERAGE_BITS, THIN_MASK_BITS, THIN_RUNS } from './thinGeometryWgsl.ts'
import { TRANSLUCENCY_WGSL } from './translucencyWgsl.ts'
import type { Wave } from './waveOps.ts'

/** The shading rejection's bindings. */
export const REJECT_SHADING_BINDINGS = {
  view: 0,
  current: 1,
  translucency: 2,
  word: 3,
  guides: 4,
  moire: 5,
  marks: 6,
  thin: 7,
  depth: 8,
  guideOut: 9,
  moireOut: 10,
  rejection: 11,
  field: 12,
  occluders: 13,
  sceneColor: 14,
  luma: 15,
  measureLuma: 16,
  thinHistory: 17,
  antiAliasMask: 18,
} as const

/** The shading rejection of each render texel, what the history update reads: the low frequency
 *  rejection, the clamp's lift, the validity's drop (stored as its complement) and `REJECTION_BITS`. */
export const REJECTION_FORMAT: GPUTextureFormat = 'rgba8unorm'

/** The filtering weight of the binomial 3×3's centre: `1 / (1 + 4·½ + 4·¼)`. */
const FILTERING_WEIGHT = 1 / (1 + 4 * 0.5 + 4 * 0.25)
/** A gradient is kept in eight bits: what lies within this is its rounding. */
const GRADIENT_EPSILON = 1 / 127
/** The most flickers the history counts, within its eight bits. */
const FLICKER_COUNT_MAX = 20
/** The flicker luma's eight-bit rounding, which its modification measure discounts. */
const LUMA_STEP_ERROR = 0.5 / 255
/** A gradient past which a thin geometry region's flicker is one, however small. */
const THIN_GEOMETRY_GRADIENT = 0.00007
/** The half step an eight-bit store rounds by, which the rejection's words are biased against. */
const HALF_STEP = quantizationError(REJECTION_FORMAT) / 2
/** The sum, over a 3×3 and the channels, of how much closer to the image the resurrected frame is
 *  than the last image's, past which a texel counts for the resurrected frame: 0.05 a channel. */
const CLOSER_SUM = 0.05 * 3 * 9
/** The texels of a 3×3 that must count for the resurrected frame for it to be closer: more than
 *  four. */
const CLOSER_MORE_THAN = 4
/** The rejection under which the last image's history is not good enough: the resurrected frame
 *  is measured where some texel of the workgroup is closer to it and rejected below this. */
const NOT_GOOD_ENOUGH = 0.5
/** How much better the resurrected frame's rejection must be than the last image's for the pixel to
 *  be resurrected. */
const BETTER_BY = 0.1

/**
 * The analysis views (`view.params.w`, `taa` of `LIT_VIEWS`,
 * `../../visibility/shader/shadeMode.ts`), from the first: the rejection's words of a texel hold, in
 * place of its own, three of the factors that can take its history away or what a pixel asks of
 * it, which the resolve shows raw (`resolveWgsl.ts`); the analysis and the shading history stay
 * those of the beauty image.
 * - 4, the flicker measure: its error (eight times) and its count (of its most);
 * - 5, the shading rejection: without the flicker error's widening, with it before the spread,
 *   then spread — the factor the history update applies;
 * - 6, the reprojection: disoccluded, hole-filled with the occluder's velocity, off screen;
 * - 7, the motion: how far the texel moves to the flicker measure (`marks`), a pixel animation, the
 *   reprojection edge (one where the velocity is flat);
 * - 8, the thin geometry (`thinGeometryWgsl.ts`): the history relaxation weight, the cluster hole
 *   region, the coverage history;
 * - 9, the responsiveness the pixel carries, as grey: black none, a third a pixel animation (a
 *   material at `medium`, or a dynamic surface), white a pixel animation whose history restarts
 *   (`full`).
 * Off, a uniform branch never taken.
 */
export const FIRST_ANALYSIS_VIEW = 4

/** The reciprocal helper of a precision (`safeRcp`, with its suffix). */
const rcpOf = ({ S }: Precision) => (S ? `safeRcp${S}` : 'safeRcp')

/** The measure's structure, its helper and the start of the rejection: the inputs held onto each
 *  other, the boxes and the clamp error. */
const measureHeadText = ({
  F,
  V3,
}: Precision) => `struct Measured{blend:array<${F},${LANE_ROWS}>,clampBlend:array<${F},${LANE_ROWS}>,plain:array<${F},${LANE_ROWS}>,raw:array<${F},${LANE_ROWS}>}
fn minOf(v:${V3})->${F}{return min(min(v.x,v.y),v.z);}
/** The rejection of the history \`heldHistory\` against the input \`input\` and the input held to the
 *  history \`heldInput\`, all in the measurement space: the filtered history held in the filtered
 *  input's box — moved toward the filtered history's own box by the thin geometry's relaxation
 *  \`relax\` where \`relaxing\` —, widened by the clamp error and by the flicker error \`moireError\` where
 *  \`moireOn\`; the energy past it against the larger of the filtered difference and the box's size,
 *  the least of the channels; its 3×3 median, then the maximum of the energy and the minimum of the
 *  raw rejection, the clamp's lift. */
fn measureRejection(input:Px,heldInput:Px,heldHistory:Px,moireError:array<${F},${LANE_ROWS}>,relax:array<${F},${LANE_ROWS}>,relaxing:bool,moireOn:bool)->Measured{
 let filteredHistory=blur3x3(heldHistory);
 var gap:Px;
 for(var r=0;r<${LANE_ROWS};r++){gap[r]=abs(input[r]-heldInput[r]);}
 let gapVariation=totalVariation3x3(gap);
 let heldStats=statistics3x3(heldInput);
 let heldBox=heldStats.box;let filteredInput=heldStats.blurred;
 var least:Px;
 for(var r=0;r<${LANE_ROWS};r++){least[r]=min(abs(gapVariation[r]),abs(heldStats.variation[r]));}
 let leastBlurred=blur3x3(least);
 var box=minMax3x3(filteredInput);
 var boxSize:array<${V3},${LANE_ROWS}>;var clampError:array<${V3},${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){
  boxSize[r]=heldBox.hi[r].rgb-heldBox.lo[r].rgb;
  clampError[r]=max(max(${V3}(Q),leastBlurred[r].rgb),boxSize[r]*${wgslF32(FILTERING_WEIGHT * 0.25)})+Q;
 }`

/** The box moved toward the filtered history's own where the thin geometry relaxes it. */
const measureRelaxText = ({ F, V4 }: Precision) => ` if(relaxing){
  var weight:array<${F},${LANE_ROWS}>;
  for(var r=0;r<${LANE_ROWS};r++){weight[r]=select(0.0,relax[r],relax[r]>${wgslF32(1 / THIN_MASK_BITS.most)});}
  let historyBox=minMax3x3(filteredHistory);
  for(var r=0;r<${LANE_ROWS};r++){box.lo[r]=${V4}(lerp3(box.lo[r].rgb,historyBox.lo[r].rgb,weight[r]),0.0);}
  var held:Px;
  for(var r=0;r<${LANE_ROWS};r++){
   box.hi[r]=${V4}(lerp3(box.hi[r].rgb,historyBox.hi[r].rgb,weight[r]),0.0);
   held[r]=${V4}(clamp(filteredHistory[r].rgb,box.lo[r].rgb,box.hi[r].rgb),0.0);
  }
  let heldRelaxed=minMax3x3(held);
  for(var r=0;r<${LANE_ROWS};r++){if(weight[r]>0.0){box.lo[r]=heldRelaxed.lo[r];box.hi[r]=heldRelaxed.hi[r];}}
 }`

/** The energy past the clamp against the delta, the median of it, and the rejection's blends. */
const measureEnergyText = (p: Precision) => {
  const { V3, V4 } = p
  const rcp = rcpOf(p)
  return ` var energy:Px;var delta:array<${V3},${LANE_ROWS}>;var m:Measured;
 for(var r=0;r<${LANE_ROWS};r++){
  let history=filteredHistory[r].rgb;
  let lo=box.lo[r].rgb-clampError[r];let hi=box.hi[r].rgb+clampError[r];
  let plainClamped=clamp(history,lo,hi);
  var clamped=plainClamped;
  let size=boxSize[r]*${wgslF32(FILTERING_WEIGHT)}+${wgslF32(2 * FILTERING_WEIGHT)}*Q;
  var widened=size;
  if(moireOn){
   let spread=${V3}(${wgslF32(LUMA_TO_CHANNEL)}*moireError[r]);
   clamped=clamp(history,min(lo,hi-spread),max(hi,lo+spread));
   let past=abs(clamped-history);
   widened=max(size,past*${rcp}(past.x+past.y+past.z)*(${wgslF32(FILTERING_WEIGHT * LUMA_TO_CHANNEL)}*moireError[r]));
  }
  let difference=abs(filteredInput[r].rgb-history);
  delta[r]=max(difference,widened);
  let e=abs(clamped-history);
  let raw=minOf(saturate(${V3}(1.0)-e*(${V3}(1.0)/delta[r])));
  energy[r]=${V4}(e,raw);
  m.raw[r]=raw;
  m.plain[r]=minOf(saturate(${V3}(1.0)-abs(plainClamped-history)*(${V3}(1.0)/max(difference,size))));
 }
 let spread=minMax3x3(median3x3(energy));
 for(var r=0;r<${LANE_ROWS};r++){
  m.blend[r]=minOf(saturate(${V3}(1.0)-spread.hi[r].rgb*(${V3}(1.0)/delta[r])));
  m.clampBlend[r]=spread.lo[r].a;
 }
 return m;
}`
}

/** Each of two values held in the 3×3 box of the other. */
const annihilateText =
  () => `/** \`toClamp\` held in the 3×3 box of \`guide\` held in the 3×3 box of \`toClamp\` (\`own\`, its 3×3 box): each
 *  brought onto the other where they overlap. */
fn annihilateToGuide(toClamp:Px,guide:Px,own:Box)->Px{
 var held:Px;
 for(var r=0;r<${LANE_ROWS};r++){held[r]=clamp(guide[r],own.lo[r],own.hi[r]);}
 let other=minMax3x3(held);
 var o:Px;
 for(var r=0;r<${LANE_ROWS};r++){o[r]=clamp(toClamp[r],other.lo[r],other.hi[r]);}
 return o;
}`

/** What the shading rejection measures of a frame's history against the image
 *  (`measureRejection`): the rejection, the clamp's lift, and for the analysis view of the
 *  rejection the rejection without the flicker error's widening and the raw one. */
const measureText = (p: Precision) =>
  `\n${[measureHeadText(p), measureRelaxText(p), measureEnergyText(p), annihilateText()].join('\n')}`
const measureWgsl = (p: Precision, wave?: Wave) =>
  wgslBlock(
    `REJECT_SHADING_MEASURE${p.S}_WGSL`,
    [...networkOf(p, wave), p.S ? colorSpacesWgsl(p) : safeRcp],
    measureText(p),
  )

/** The names a precision gives the rejection's stages, and the conversions its types ask: `rcp` the
 *  reciprocal, `cast(T, e)` the expression `e` as type `T` where the precision is not 32 bits' (a
 *  conversion to or from it), `bounded(e)` a 32-bit bound `e` the 16-bit precision holds within its
 *  largest finite. */
interface RejectionTypes extends Precision {
  readonly rcp: string
  readonly cast: (T: string, e: string) => string
  readonly bounded: (e: string) => string
}
const rejectionTypes = (p: Precision): RejectionTypes => ({
  ...p,
  rcp: rcpOf(p),
  cast: (T, e) => (p.S ? `${T}(${e})` : e),
  bounded: (e) => (p.S ? `${p.F}(min(${e},${wgslF32(HALF_MAX)}))` : e),
})

/** The shading rejection's bindings. */
const rejectionBindingsText = (
  guideFormat: GPUTextureFormat,
  maskForm: StorageForm,
  lumaForm: StorageForm,
) => {
  const B = REJECT_SHADING_BINDINGS
  return `@group(0) @binding(${B.view}) var<uniform> view:TaaView;
@group(0) @binding(${B.current}) var current:texture_2d<f32>;
@group(0) @binding(${B.translucency}) var translucency:texture_2d<f32>;
@group(0) @binding(${B.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${B.guides}) var guides:texture_2d_array<f32>;
@group(0) @binding(${B.moire}) var moire:texture_2d<f32>;
@group(0) @binding(${B.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${B.thin}) var thin:texture_2d<f32>;
@group(0) @binding(${B.measureLuma}) var measuredLuma:texture_2d<f32>;
@group(0) @binding(${B.thinHistory}) var thinHistory:texture_2d<f32>;
@group(0) @binding(${B.depth}) var depth:texture_depth_2d;
@group(0) @binding(${B.guideOut}) var guideOut:texture_storage_2d<${guideFormat},write>;
@group(0) @binding(${B.moireOut}) var moireOut:texture_storage_2d<${FLICKER_FORMAT},write>;
@group(0) @binding(${B.rejection}) var rejectionOut:texture_storage_2d<${REJECTION_FORMAT},write>;
${storageDeclaration(ANTI_ALIAS_MASK, maskForm, 'write', B.antiAliasMask)}
@group(0) @binding(${B.field}) var fieldOut:texture_storage_2d_array<${FIELD_FORMAT},write>;
@group(0) @binding(${B.occluders}) var<storage,read_write> occluders:array<u32>;
@group(0) @binding(${B.sceneColor}) var<storage,read_write> sceneColorOut:array<u32>;
${storageDeclaration(LDR_LUMA, lumaForm, 'write', B.luma)}`
}

/** The resurrection switch, the constants and the helpers the stages share. */
const rejectionHelpersText = () => `override RESURRECTION:bool=false;
const Q=${wgslF32(DISPLAY_STEP_ERROR)};
/** The thin geometry detection's history relaxation weight of texel \`c\`, in 127ths. */
fn relaxationOf(c:vec2i)->f32{return f32(measureByte(textureLoad(thin,c,0).r)>>${THIN_MASK_BITS.shift}u)/${THIN_MASK_BITS.most}.0;}
/** The words of analysis view \`mode\` (\`FIRST_ANALYSIS_VIEW\`) of texel \`c\`, its reprojection word
 *  \`word\`, its flicker error and count, and its rejection's three stages. */
fn analysisView(mode:u32,c:vec2i,word:u32,moireError:f32,moireCount:f32,plain:f32,raw:f32,rejected:f32)->vec3f{
 let bit=vec3u(${REPROJECT_BITS.disoccluded}u,${REPROJECT_BITS.filled}u,${REPROJECT_BITS.offScreen}u);
 if(mode==${FIRST_ANALYSIS_VIEW}u){return vec3f(saturate(moireError*8.0),moireCount,0.0);}
 if(mode==${FIRST_ANALYSIS_VIEW + 1}u){return vec3f(plain,raw,rejected);}
 if(mode==${FIRST_ANALYSIS_VIEW + 2}u){return select(vec3f(0.0),vec3f(1.0),(vec3u(word)&bit)!=vec3u(0u));}
 if(mode==${FIRST_ANALYSIS_VIEW + 5}u){
  return vec3f(f32(select(0u,1u,isAnimated(word))+select(0u,2u,asksRestart(word)))/3.0);
 }
 if(mode==${FIRST_ANALYSIS_VIEW + 4}u){
  let mask=measureByte(textureLoad(thin,c,0).r);let coverage=measureByte(textureLoad(thinHistory,c,0).r);
  let weight=f32(mask>>${THIN_MASK_BITS.shift}u)/${THIN_MASK_BITS.most}.0;
  return vec3f(weight,f32(mask&${THIN_MASK_BITS.clusterHole}u),f32(coverage>>${THIN_COVERAGE_BITS.shift}u)/${THIN_COVERAGE_BITS.most}.0);
 }
 return vec3f(f32(textureLoad(marks,c,0).b)/255.0,select(0.0,1.0,isAnimated(word)),reprojectionEdge(word));
}`

/** The entry's head: the lane's place in the tile and the arrays the stages share. A wave program
 *  fixes the size of its subgroups where the adapter runs others (`Wave.pinned`) and takes its
 *  column from its place in the subgroup (`subgroup_invocation_id`), the row of lanes the subgroup
 *  is, the shuffles' lanes; the rows are the workgroup's index's. */
const entryHeadText = ({ F }: RejectionTypes, wave: Wave | undefined) => {
  const tile = REJECT_SHADING_TILE
  const overscan = REJECT_SHADING_OVERSCAN
  return `@compute @workgroup_size(${REJECT_SHADING_LANES})${wave?.pinned ? ` @subgroup_size(${wave.lanes})` : ''}
fn rejectShading(@builtin(workgroup_id) wg:vec3u,@builtin(local_invocation_index) lane:u32${wave ? ',@builtin(subgroup_invocation_id) inSubgroup:u32' : ''}){
 laneX=i32(${wave ? 'inSubgroup' : `lane%${tile}u`});laneRow=i32(lane/${tile}u)*${LANE_ROWS};
 let origin=vec2i(wg.xy)*${REJECT_SHADING_STRIDE}-vec2i(${overscan});
 let size=vec2i(view.render.xy);
 let scale=view.exposure.x*view.preExposure.y;
 let most=${wgslF32(LARGEST_SCENE_COLOR)}/scale;
 var pixel:array<vec2i,${LANE_ROWS}>;var place:array<vec2i,${LANE_ROWS}>;
 var inner:array<bool,${LANE_ROWS}>;var writes:array<bool,${LANE_ROWS}>;
 var word:array<u32,${LANE_ROWS}>;var composed:array<vec3f,${LANE_ROWS}>;var layers:array<vec4f,${LANE_ROWS}>;var opaque:array<vec3f,${LANE_ROWS}>;
 var relax:array<${F},${LANE_ROWS}>;`
}

/** The store of the LDR luma `luma` of texel `g` (place `at`), in the luma's form. */
const lumaStoreText = (form: StorageForm) =>
  form === 'texture'
    ? '    textureStore(lumaOut,g,vec4f(luma/(0.5+luma),0.0,0.0,0.0));'
    : `    let shift=(at&3u)*8u;
    atomicAnd(&lumaOut[at>>2u],~(0xffu<<shift));
    atomicOr(&lumaOut[at>>2u],(pack4x8unorm(vec4f(luma/(0.5+luma),0.0,0.0,0.0))&0xffu)<<shift);`

/** Each texel of the tile loaded once, and the scene colour and LDR luma it writes. */
const loadText = (colorFormat: GPUTextureFormat, lumaForm: StorageForm) => {
  const tile = REJECT_SHADING_TILE
  const overscan = REJECT_SHADING_OVERSCAN
  return ` for(var r=0;r<${LANE_ROWS};r++){
  let t=vec2i(laneX,laneRow+r);let g=origin+t;
  place[r]=g;pixel[r]=clamp(g,vec2i(0),size-vec2i(1));
  inner[r]=all(t>=vec2i(${overscan}))&&all(t<vec2i(${tile - overscan}));
  writes[r]=inner[r]&&all(g<size);
  let c=pixel[r];
  word[r]=textureLoad(reprojected,c,0).r;
  let image=textureLoad(current,c,0);let raw=image.rgb;
  let lay=layersAt(c);
  layers[r]=lay;opaque[r]=beforeLayers(raw,lay);composed[r]=min(raw,vec3f(most));
  // The scene colour the history update reads, held below the largest scene colour and the largest
  // small float, rounded stochastically to the history's colour format; and, where the level runs the
  // spatial anti-aliaser (view.quality.y), its LDR luma, which the anti-aliaser browses: a texel of
  // an 8-bit texture, or a byte of a word others share — an atomic clears it, another sets it.
  if(writes[r]){
   let scene=min(min(raw,vec3f(${wgslF32(LARGEST_SCENE_COLOR)})),vec3f(${wgslF32(MAX_10_BIT_FLOAT)}));
   let at=u32(g.y)*u32(view.analysisGrid.x)+u32(g.x);
   let dithered=ditherFloat(scene,frameRandom(g,u32(view.jitter.w)).x,${quantizationErrorsOf(colorFormat)});
   let packed=packSceneColor(vec4f(dithered,image.a));
   for(var k=0u;k<${sceneColorWords(colorFormat)}u;k++){sceneColorOut[at*${sceneColorWords(colorFormat)}u+k]=packed[k];}
   if(view.quality.y>0.0){
    let luma=luma601(scene);
${lumaStoreText(lumaForm)}
   }
  }
 }`
}

/** The thin geometry's relaxation, where the detection runs and some texel has one. */
const relaxationText = ({
  F,
  cast,
}: RejectionTypes) => ` // The thin geometry's relaxation, where the detection runs and some texel of the tile has one.
 var relaxing=false;
 if(${THIN_RUNS}){
  var some=false;
  for(var r=0;r<${LANE_ROWS};r++){relax[r]=${cast(F, 'relaxationOf(pixel[r])')};some=some||relax[r]>0.0;}
  relaxing=anyThread(some);
 }`

/** The flicker measure's inputs: the luma and its history, held onto each other and blurred. */
const flickerInputsText = ({
  F,
  V4,
  cast,
}: RejectionTypes) => ` var moireError:array<${F},${LANE_ROWS}>;var moireCount:array<${F},${LANE_ROWS}>;
 if(view.quality.x>0.0||view.params.w>=${FIRST_ANALYSIS_VIEW}.0){
  var lumas:Px;var prev:array<${V4},${LANE_ROWS}>;var modification:array<${F},${LANE_ROWS}>;var still:array<${F},${LANE_ROWS}>;
  for(var r=0;r<${LANE_ROWS};r++){
   let c=pixel[r];
   let scene=opaque[r]*scale;
   // The flicker luma measured before the translucency, in the gamma space: squared to the measurement's.
   let measured=textureLoad(measuredLuma,c,0).r;
   let inputLuma=measured*measured;
   let change=dot(abs(linearToMeasure(scene)-linearToMeasure(composed[r]*scale)),vec3f(${wgslF32(1 / LUMA_TO_CHANNEL)}));
   modification[r]=${cast(F, `max(max(max(0.0,abs(inputLuma-measureLuma(scene))-${wgslF32(LUMA_STEP_ERROR)}),change),1.0-layers[r].a)`)};
   prev[r]=${cast(V4, 'textureLoad(moire,c,0)')};
   still[r]=${cast(F, '1.0-f32(textureLoad(marks,c,0).b)/255.0')};
   lumas[r]=${V4}(${cast(F, 'inputLuma')},prev[r].x*prev[r].x,0.0,0.0);
  }
  // The input and the history each held onto the other, then blurred with the luma's modification.
  var swapped:Px;
  for(var r=0;r<${LANE_ROWS};r++){swapped[r]=lumas[r].yxzw;}
  let crossed=annihilateToGuide(lumas,swapped,minMax3x3(lumas));
  var held:Px;
  for(var r=0;r<${LANE_ROWS};r++){held[r]=${V4}(crossed[r].x,modification[r],crossed[r].y,0.0);}
  let filtered=blur3x3(held);
  var withHeld:Px;
  for(var r=0;r<${LANE_ROWS};r++){withHeld[r]=${V4}(filtered[r].x,held[r].x,0.0,0.0);}
  let box=minMax3x3(withHeld);
  var lo:array<${F},${LANE_ROWS}>;var hi:array<${F},${LANE_ROWS}>;var weight:array<${F},${LANE_ROWS}>;
  for(var r=0;r<${LANE_ROWS};r++){lo[r]=box.lo[r].x;hi[r]=box.hi[r].x;weight[r]=select(0.0,relax[r],relaxing&&relax[r]>${wgslF32(1 / THIN_MASK_BITS.most)});}`

/** The flicker measure's box, relaxed by the thin geometry, and the energy past it. */
const flickerBoxText = ({ F, V4 }: RejectionTypes) => `  if(relaxing){
   var past:Px;
   for(var r=0;r<${LANE_ROWS};r++){past[r]=${V4}(filtered[r].z,0.0,0.0,0.0);}
   let own=minMax3x3(past);
   var kept:Px;
   for(var r=0;r<${LANE_ROWS};r++){
    lo[r]=lerpOf(lo[r],own.lo[r].x,weight[r]);hi[r]=lerpOf(hi[r],own.hi[r].x,weight[r]);
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

/** The history update replayed on the luma, and what of its gradient is a flicker. */
const flickerReplayText = ({ F, V4, rcp, cast }: RejectionTypes) => {
  const G = wgslF32(FLICKER_GHOSTING)
  return `  // The history update replayed on the luma, and what of its gradient is a flicker.
  let plus=minMaxPlus3x3(lumas);
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
   if(isRestarted(word[r])){newGradient=0.0;total=0.0;count=0.0;}
   let kept=floor(count*${wgslF32(255 / FLICKER_COUNT_MAX)})*${wgslF32(FLICKER_COUNT_MAX / 255)};
   total=total*kept*${rcp}(count);
   let fade=saturate(count*${cast(F, 'select(view.exposure.z,view.exposure.w,thinRegion[r])')}-0.5);
   let error=(abs(total*${rcp}(count))+count*${wgslF32(GRADIENT_EPSILON)})*fade;
   moireError[r]=saturate(error*still[r]-modification[r]);
   moireCount[r]=kept/${FLICKER_COUNT_MAX}.0;
   if(writes[r]){textureStore(moireOut,place[r],vec4f(${V4}(history[r],newGradient*${wgslF32(127 / 255)}+${wgslF32(127 / 255)},total,moireCount[r])));}
  }
 }`
}

/** The histories and the rejection's input in the measurement space, and the texels the
 *  resurrected frame is closer to. */
const historiesText = ({
  F,
  V3,
  V4,
  S,
  cast,
  bounded,
}: RejectionTypes) => ` // The histories, the rejection's input and both in the measurement space.
 let resurrecting=RESURRECTION&&view.resurrection.x!=0.0;
 var guide:array<${V4},${LANE_ROWS}>;var other:array<${V4},${LANE_ROWS}>;var blurIn:Px;
 for(var r=0;r<${LANE_ROWS};r++){
  guide[r]=${cast(V4, `textureLoad(guides,pixel[r],${GUIDE_LAYERS.previous},0)`)};
  if(resurrecting){other[r]=${cast(V4, `textureLoad(guides,pixel[r],${GUIDE_LAYERS.resurrected},0)`)};}
  blurIn[r]=${cast(V4, 'select(layers[r],vec4f(composed[r],0.0),isAnimated(word[r]))')};
 }
 let blurred=blur3x3(blurIn);
 var input:array<${V3},${LANE_ROWS}>;var exposedInput:Px;var exposedHistory:Px;
 for(var r=0;r<${LANE_ROWS};r++){
  let sharp=${cast(V3, 'select(opaque[r],vec3f(0.0),isAnimated(word[r]))')};
  input[r]=min(sharp*blurred[r].a+blurred[r].rgb,${V3}(${bounded('most')}));
  exposedInput[r]=${V4}(linearToMeasure${S}(input[r]*${cast(F, 'scale')}),0.0);
  exposedHistory[r]=${V4}(guide[r].rgb*guide[r].rgb,0.0);
 }
 var closer:array<bool,${LANE_ROWS}>;
 if(resurrecting){
  var gap:Px;
  for(var r=0;r<${LANE_ROWS};r++){
   let ei=exposedInput[r].rgb;let past=other[r].rgb*other[r].rgb;
   let d=abs(ei-exposedHistory[r].rgb)-abs(ei-past);
   gap[r]=${V4}(d.x+d.y+d.z);
  }
  let total=sum3x3(gap);
  var counts:Px;
  for(var r=0;r<${LANE_ROWS};r++){counts[r]=${V4}(select(${F}(0.0),${F}(1.0),total[r].x>${wgslF32(CLOSER_SUM)}));}
  let count=sum3x3(counts);
  for(var r=0;r<${LANE_ROWS};r++){
   closer[r]=count[r].x>${wgslF32(CLOSER_MORE_THAN)}&&(word[r]&${REPROJECT_BITS.resurrectionOffScreen}u)==0u&&!asksRestart(word[r]);
  }
 }`

/** The rejection of the last image's history. */
const holdText = ({
  cast,
}: RejectionTypes) => ` // The input held to the history held in its box, the history held to the input.
 let inputBox=minMax3x3(exposedInput);
 var visible:array<bool,${LANE_ROWS}>;var heldHistory:Px;
 for(var r=0;r<${LANE_ROWS};r++){
  visible[r]=luma601(${cast('vec3f', 'inputBox.hi[r].rgb-inputBox.lo[r].rgb')})>${SPATIAL_ANTI_ALIASER_MIN_LUMINANCE};
  heldHistory[r]=clamp(exposedHistory[r],inputBox.lo[r],inputBox.hi[r]);
 }
 let heldBox=minMax3x3(heldHistory);
 var heldInput:Px;
 for(var r=0;r<${LANE_ROWS};r++){heldInput[r]=clamp(exposedInput[r],heldBox.lo[r],heldBox.hi[r]);}
 let historyHeld=annihilateToGuide(exposedHistory,exposedInput,minMax3x3(exposedHistory));
 let moireOn=view.quality.x>0.0;
 let measured=measureRejection(exposedInput,heldInput,historyHeld,moireError,relax,relaxing,moireOn);
 var blend=measured.blend;var clampBlend=measured.clampBlend;
 var resurrect:array<bool,${LANE_ROWS}>;`

/** The resurrected frame's rejection, measured where some texel of the workgroup is closer. */
const resurrectText = ({ F, V4 }: RejectionTypes) => ` if(resurrecting){
  var worth=false;
  for(var r=0;r<${LANE_ROWS};r++){worth=worth||(closer[r]&&blend[r]<${wgslF32(NOT_GOOD_ENOUGH)}&&inner[r]);}
  if(anyThread(worth)){
   var exposedOther:Px;
   for(var r=0;r<${LANE_ROWS};r++){exposedOther[r]=${V4}(other[r].rgb*other[r].rgb,0.0);}
   let otherInput=annihilateToGuide(exposedInput,exposedOther,inputBox);
   let otherHistory=annihilateToGuide(exposedOther,exposedInput,minMax3x3(exposedOther));
   var none:array<${F},${LANE_ROWS}>;
   let fromOther=measureRejection(exposedInput,otherInput,otherHistory,none,none,false,moireOn);
   for(var r=0;r<${LANE_ROWS};r++){
    resurrect[r]=closer[r]&&fromOther.blend[r]-blend[r]>${wgslF32(BETTER_BY)}&&inner[r];
    if(resurrect[r]){blend[r]=fromOther.blend[r];clampBlend[r]=fromOther.clampBlend[r];}
   }
  }
 }`

/** The history each pixel keeps and the outputs: shading history, field, rejection words, occluders. */
const outputsText = (
  { F, V3, V4, S, cast }: RejectionTypes,
  guideFormat: GPUTextureFormat,
) => ` // The history each pixel keeps, its edges' 3×3 minimum, and the outputs.
 var keptEdge:Px;
 for(var r=0;r<${LANE_ROWS};r++){
  if(resurrect[r]){guide[r]=other[r];}
  keptEdge[r]=${V4}(guide[r].a);
 }
 let historyEdge=min3x3(keptEdge);
 for(var r=0;r<${LANE_ROWS};r++){
  if(!writes[r]){continue;}
  let g=place[r];
  if(resurrect[r]){
   let field=resurrectionField(screenOfTexel(g),closestDepthOf(g));
   textureStore(fieldOut,g,${FIELD_LAYERS.vector},vec4u(encodeVector(field.vector),0u,0u,0u));
   if(view.fraction.w!=0.0){textureStore(fieldOut,g,${FIELD_LAYERS.jacobian},vec4u(encodeReprojectionJacobian(field.jacobian.j0,field.jacobian.j1),0u,0u,0u));}
  }
  let w=word[r];
  let restarted=isRestarted(w);
  let reset=restarted&&!resurrect[r];
  let edge=reprojectionEdge(w);
  let total=select(saturate(1.0-blend[r]*4.0),1.0,restarted);
  let rejectedShare=max(${cast(F, 'view.rates.y')},1.0-blend[r]);
  let taken=max(rejectedShare,total);
  let ei=addPerception${S}(input[r]*${cast(F, 'scale')},1.0);
  let eh=addPerception${S}(perceptualToLinear${S}(guide[r].rgb),1.0);
  let updated=linearToPerceptual${S}(removePerception${S}(ei*taken-eh*(taken-1.0),1.0));
  let dither=${cast(F, 'frameRandom(vec2i(laneX,laneRow+r),u32(view.jitter.w)).x')};
  textureStore(guideOut,g,vec4f(${cast(V4, `ditherUnorm${S}(updated,dither,${wgslF32(quantizationError(guideFormat))}),${cast(F, 'edge')}`)}));
  let lift=select(min(clampBlend[r],min(${cast(F, 'edge')},historyEdge[r].x)),0.0,reset);
  let raise=select(clampBlend[r],0.0,reset);
  let antiAlias=view.quality.y>0.0&&visible[r]&&(blend[r]<0.25||reset);
  let bits=select(${REJECTION_BITS.kept}u,0u,restarted)|select(0u,${REJECTION_BITS.resurrected}u,resurrect[r]);
  var words=vec3f(${cast(V3, `blend[r]-${wgslF32(HALF_STEP)},lift-${wgslF32(HALF_STEP)},${wgslF32(1 - HALF_STEP)}-raise`)});
  if(view.params.w>=${FIRST_ANALYSIS_VIEW}.0){
   words=analysisView(u32(view.params.w),g,w,${['moireError[r]', 'moireCount[r]', 'measured.plain[r]', 'measured.raw[r]', 'blend[r]'].map((e) => cast('f32', e)).join(',')});
  }
  textureStore(rejectionOut,g,vec4f(words,f32(bits)/255.0));
  antiAliasMaskSet(g,antiAlias);
  let index=u32(g.y)*u32(size.x)+u32(g.x);
  occluders[index]=0u;
  if(view.radius.w!=0.0){occluders[u32(size.x)*u32(size.y)+index]=0u;}
 }
}`

const entryText = (
  t: RejectionTypes,
  guideFormat: GPUTextureFormat,
  colorFormat: GPUTextureFormat,
  lumaForm: StorageForm,
  wave: Wave | undefined,
) =>
  [
    entryHeadText(t, wave),
    loadText(colorFormat, lumaForm),
    relaxationText(t),
    flickerInputsText(t),
    flickerBoxText(t),
    flickerReplayText(t),
    historiesText(t),
    holdText(t),
    resurrectText(t),
    outputsText(t, guideFormat),
  ].join('\n')

/**
 * THE SHADING REJECTION, one workgroup per `REJECT_SHADING_STRIDE` square of render texels, after the
 * history reprojection and the thin geometry detection: how far each frame's history disagrees with
 * the image in shading, which history each pixel keeps, and what the later passes read of it —
 * every step in the workgroup's network (`networkOf`), no value of it stored between them.
 * - The flicker measure, where the level rejects by it (`view.quality.x`) or an analysis view is
 *   shown: the flicker luma measured on the scene before the translucency, in eight bits
 *   (`measureFlickerLumaShader`, `flickerLumaWgsl.ts`), how far the translucency and the rounding
 *   modified it — against the scene the composed image held before its layers (`beforeLayers`), and the reprojected flicker history; the rejection's heuristic on
 *   that one channel — the input and the history each held onto the other, blurred, the box —
 *   relaxed toward the history by the thin geometry's weight —, the clamp error, the energy past it
 *   against the delta, its median then its maximum and minimum —; the history update replayed and
 *   its gradient, less the luma's modification, against a ghosting update (`FLICKER_GHOSTING`); a
 *   flicker where the gradient and the accumulated one have opposite signs past their rounding — or
 *   in a thin geometry region, any gradient —, never across a cut; its swing and its count spread
 *   by their 3×3 maxima twice, added to the history's faded totals (none where the texel moves or
 *   is disoccluded); the error, the mean swing plus the count's rounding, faded in over the flicker
 *   period, kept to still texels less the luma's modification. Written: the flicker history.
 * - The input for the rejection: the scene under the translucency composed with the translucency's
 *   3×3 blur — a pixel animation taking its whole colour into that blur —; the history: the shading
 *   history reprojected (`reprojectWgsl.ts`), squared back to the measurement space. Written for
 *   the later passes: the scene colour held below the largest scene colour and small float, rounded
 *   stochastically to the history's colour format `colorFormat` into a buffer of its words
 *   (`sceneColorWgsl`), which the history update reads; where the level runs the spatial
 *   anti-aliaser, its LDR luma, which the anti-aliaser browses: a texel of an `r8unorm` texture
 *   (`StorageForm`), else a byte a texel of a buffer (`LDR_LUMA.words`) — four texels of a row share
 *   a word, and the texels of one word may be two workgroups': each texel clears its byte and sets
 *   it, two atomics on bytes no other texel touches.
 * - The input held to the history and the history to the input (each within the other's 3×3 box
 *   held within its own); whether aliasing is visible, the input's box above the anti-aliaser's
 *   luma contrast; the rejection of the last image's history (`measureRejection`), widened by the
 *   flicker error where the level rejects by it, relaxed by the thin geometry where it runs.
 * - Resurrection, where the history resurrects (`RESURRECTION`) and may this image
 *   (`view.resurrection.x`): the resurrected frame is closer to the image where, over the 3×3, the
 *   channels' differences to the last image's history less those to the resurrected one's sum past
 *   `CLOSER_SUM`, more than `CLOSER_MORE_THAN` texels of the 3×3 hold so, the texel is not off its screen
 *   and its material asks no restart; where some written texel of the workgroup is closer and
 *   rejected below `NOT_GOOD_ENOUGH`, the resurrected frame's rejection is measured too, and a texel
 *   closer to it whose rejection it betters by `BETTER_BY` is resurrected: its rejection, clamp's
 *   lift, history and reprojection — the vector and, where the level reprojects by the field
 *   (`view.fraction.w`), the jacobian of the reprojection to that frame — are that frame's.
 * - The shading history for the next image: in a perception space, the image blended with the
 *   history the pixel keeps at the rejection's blend factor — at least the factor a whole history
 *   takes the image at, in full where the history is rejected or disoccluded —, dithered to the
 *   bits of `guideFormat` (`HistoryFormats.guide`), beside the reprojection edge. The clamp's lift: none where disoccluded and not
 *   resurrected, else the least of the clamp's lift, the reprojection edge and the kept history's
 *   edges over the 3×3; the validity's drop as far as the clamp holds; the spatial anti-aliaser
 *   where the level runs one (`view.quality.y`), aliasing is visible and the history rejected
 *   below a quarter or disoccluded. An analysis view's words in place of the rejection's own.
 * - Each written texel empties its closest occluder word — its second under an orthographic
 *   projection — for the next image's scatter (`velocityWgsl.ts`): the reprojection read them last.
 * The image's colour, the translucency, the reprojection word and the shading histories are loaded
 * once per texel of the tile; the flicker history, the marks and the thin geometry mask where the
 * steps that read them run.
 *
 * Run as a subgroup of the tile's width (`runAs`, `rejectionWaveOf`; else the plain program), the
 * network's horizontal exchange is a shuffle and its workgroup memory only the subgroups' first and
 * last rows (`rejectionNetworkWgsl.ts`): the same values.
 */
export const rejectShadingShader = (
  guideFormat: GPUTextureFormat,
  colorFormat: GPUTextureFormat,
  half = false,
  maskForm: StorageForm = 'buffer',
  lumaForm: StorageForm = 'buffer',
  runAs?: Wave,
) => {
  const p = half ? HALF_PRECISION : FULL_PRECISION
  const wave = rejectionWaveOf(runAs)
  return wgslProgram(
    [
      rejectionBindingsText(guideFormat, maskForm, lumaForm),
      rejectionHelpersText(),
      entryText(rejectionTypes(p), guideFormat, colorFormat, lumaForm, wave),
    ].join('\n'),
    [
      ...p.enable,
      ...packedStorageWgsl(
        guideFormat,
        ...(maskForm === 'texture' ? [ANTI_ALIAS_MASK.format] : []),
        ...(lumaForm === 'texture' ? [LDR_LUMA.format] : []),
      ),
      TAA_VIEW_WGSL,
      colorSpacesWgsl(p),
      ditherWgsl(p),
      sceneColorWgsl(colorFormat),
      MEASURE_BYTE_WGSL,
      LUMA_601_WGSL,
      antiAliasMaskWgsl(maskForm, 'write'),
      REPROJECTED_WORD_WGSL,
      RESURRECTION_WGSL,
      TRANSLUCENCY_WGSL,
      measureWgsl(p, wave),
      safeRcp,
    ],
  )
}
