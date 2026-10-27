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
import { MAX_10_BIT_FLOAT } from '../../../../math/src/constants.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { safeRcp } from '../../../../math/src/wgsl/reals.ts'
import { TAA_VIEW_WGSL, packedStorageWgsl } from './bindingsWgsl.ts'
import {
  colorSpacesWgsl,
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
import { flickerMeasureWgsl } from './flickerMeasureWgsl.ts'
import { rcpOf, rejectionTypes, type RejectionTypes } from './rejectionTypes.ts'
import { REJECTION_BITS } from './rejectionBits.ts'
import {
  annihilateWgsl,
  DISPLAY_STEP_ERROR_WGSL,
  FILTERING_WEIGHT,
  FIRST_ANALYSIS_VIEW,
  FLICKER_GATES_WGSL,
} from './rejectionShared.ts'
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
  marks: 5,
  thin: 6,
  depth: 7,
  guideOut: 8,
  rejection: 9,
  field: 10,
  occluders: 11,
  sceneColor: 12,
  luma: 13,
  thinHistory: 14,
  antiAliasMask: 15,
  flicker: 16,
  measuredLuma: 17,
  flickerOut: 18,
} as const

/** The shading rejection of each render texel, what the history update reads: the low frequency
 *  rejection, the clamp's lift, the validity's drop (stored as its complement) and `REJECTION_BITS`. */
export const REJECTION_FORMAT: GPUTextureFormat = 'rgba8unorm'

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
 *  \`relax\` where \`relaxing\` —, widened by the clamp error and by the flicker error \`cellError\` where
 *  \`flickerOn\`, and by the blur of the lesser total variation of the input's change and of the input;
 *  the energy past it against the larger of the filtered difference and the box's size,
 *  the least of the channels; its 3×3 median, then the maximum of the energy and the minimum of the
 *  raw rejection, the clamp's lift. */
fn measureRejection(input:Px,heldInput:Px,heldHistory:Px,cellError:array<${F},${LANE_ROWS}>,relax:array<${F},${LANE_ROWS}>,relaxing:bool,flickerOn:bool)->Measured{
 let filteredHistory=blur3x3(heldHistory);
 var gap:Px;
 for(var r=0;r<${LANE_ROWS};r++){gap[r]=abs(input[r]-heldInput[r]);}
 let heldPair=statisticsAndVariation(heldInput,gap);
 let heldStats=heldPair.first;let gapVariation=heldPair.second;
 let heldBox=heldStats.box;let filteredInput=heldStats.blurred;
 var least:Px;
 for(var r=0;r<${LANE_ROWS};r++){least[r]=min(abs(gapVariation[r]),abs(heldStats.variation[r]));}
 let leastPair=blurAndMinMax(least,filteredInput);
 let leastBlurred=leastPair.first;var box=leastPair.second;
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
  if(flickerOn){
   let spread=${V3}(${wgslF32(LUMA_TO_CHANNEL)}*cellError[r]);
   clamped=clamp(history,min(lo,hi-spread),max(hi,lo+spread));
   let past=abs(clamped-history);
   widened=max(size,past*${rcp}(past.x+past.y+past.z)*(${wgslF32(FILTERING_WEIGHT * LUMA_TO_CHANNEL)}*cellError[r]));
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

/** What the shading rejection measures of a frame's history against the image
 *  (`measureRejection`): the rejection, the clamp's lift, and for the analysis view of the
 *  rejection the rejection without the flicker error's widening and the raw one. */
const measureText = (p: Precision) =>
  `\n${[measureHeadText(p), measureRelaxText(p), measureEnergyText(p)].join('\n')}`
const measureWgsl = (p: Precision, wave?: Wave) =>
  wgslBlock(
    `REJECT_SHADING_MEASURE${p.S}_WGSL`,
    [
      ...networkOf(p, wave),
      annihilateWgsl(p, wave),
      DISPLAY_STEP_ERROR_WGSL,
      p.S ? colorSpacesWgsl(p) : safeRcp,
    ],
    measureText(p),
  )

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
@group(0) @binding(${B.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${B.thin}) var thin:texture_2d<f32>;
@group(0) @binding(${B.thinHistory}) var thinHistory:texture_2d<f32>;
@group(0) @binding(${B.depth}) var depth:texture_depth_2d;
@group(0) @binding(${B.guideOut}) var guideOut:texture_storage_2d<${guideFormat},write>;
@group(0) @binding(${B.rejection}) var rejectionOut:texture_storage_2d<${REJECTION_FORMAT},write>;
${storageDeclaration(ANTI_ALIAS_MASK, maskForm, 'write', B.antiAliasMask)}
@group(0) @binding(${B.field}) var fieldOut:texture_storage_2d_array<${FIELD_FORMAT},write>;
@group(0) @binding(${B.occluders}) var<storage,read_write> occluders:array<u32>;
@group(0) @binding(${B.sceneColor}) var<storage,read_write> sceneColorOut:array<u32>;
${storageDeclaration(LDR_LUMA, lumaForm, 'write', B.luma)}
@group(0) @binding(${B.flicker}) var flicker:texture_2d<f32>;
@group(0) @binding(${B.measuredLuma}) var measuredLuma:texture_2d<f32>;
@group(0) @binding(${B.flickerOut}) var flickerOut:texture_storage_2d<${FLICKER_FORMAT},write>;`
}

/** The thin geometry detection's history relaxation weight, which the
 *  shading rejection and the flicker measure (`flickerMeasureWgsl.ts`) read from a texture `thin`,
 *  the resurrection switch and the helpers the stages share. */
const rejectionHelpersText =
  () => `/** The thin geometry detection's history relaxation weight of texel \`c\`, in 127ths. */
fn relaxationOf(c:vec2i)->f32{return f32(measureByte(textureLoad(thin,c,0).r)>>${THIN_MASK_BITS.shift}u)/${THIN_MASK_BITS.most}.0;}
override RESURRECTION:bool=false;
/** The words of analysis view \`mode\` (\`FIRST_ANALYSIS_VIEW\`) of texel \`c\`, its reprojection word
 *  \`word\`, its flicker error and count, and its rejection's three stages. */
fn analysisView(mode:u32,c:vec2i,word:u32,cellError:f32,cellCount:f32,plain:f32,raw:f32,rejected:f32)->vec3f{
 let bit=vec3u(${REPROJECT_BITS.disoccluded}u,${REPROJECT_BITS.filled}u,${REPROJECT_BITS.offScreen}u);
 if(mode==${FIRST_ANALYSIS_VIEW}u){return vec3f(saturate(cellError*8.0),cellCount,0.0);}
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

/** The head of an entry `name` over the shading rejection's tiles: the lane's place in the tile and
 *  the image's scale. A wave program fixes the size of its subgroups where the adapter runs others
 *  (`Wave.pinned`) and takes its column from its place in the subgroup (`subgroup_invocation_id`),
 *  the row of lanes the subgroup is, the shuffles' lanes; the rows are the workgroup's index's. */
const tileEntryText = (name: string, wave: Wave | undefined) => {
  const tile = REJECT_SHADING_TILE
  return `@compute @workgroup_size(${REJECT_SHADING_LANES})${wave?.pinned ? ` @subgroup_size(${wave.lanes})` : ''}
fn ${name}(@builtin(workgroup_id) wg:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32${wave ? ',@builtin(subgroup_invocation_id) inSubgroup:u32' : ''}){
 laneX=i32(${wave ? 'inSubgroup' : `lane%${tile}u`});laneRow=i32(lane/${tile}u)*${LANE_ROWS};
 let origin=vec2i(wg.xy)*${REJECT_SHADING_STRIDE}-vec2i(${REJECT_SHADING_OVERSCAN});
 let size=vec2i(view.render.xy);
 let scale=view.preExposure.y;
 let most=${wgslF32(LARGEST_SCENE_COLOR)}/scale;`
}

/** The entry's head: the lane's place in the tile and the arrays the stages share. */
const entryHeadText = (
  { F }: RejectionTypes,
  wave: Wave | undefined,
) => `${tileEntryText('rejectShading', wave)}
 var pixel:array<vec2i,${LANE_ROWS}>;var place:array<vec2i,${LANE_ROWS}>;
 var inner:array<bool,${LANE_ROWS}>;var writes:array<bool,${LANE_ROWS}>;
 var word:array<u32,${LANE_ROWS}>;var composed:array<vec3f,${LANE_ROWS}>;var layers:array<vec4f,${LANE_ROWS}>;var opaque:array<vec3f,${LANE_ROWS}>;
 var relax:array<${F},${LANE_ROWS}>;`

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

/** The flicker measure (`flickerMeasureWgsl.ts`) over the tile, where the level rejects by it or an
 *  analysis view is shown: its error and count at each texel of the tile, none else. It is given the
 *  thin geometry's relaxation only where `thinAntiFlickers`; the rejection after it takes it whole. */
const flickerReadText = () => ` var flick:Flicker;
 if(flickerMeasured()){flick=measureFlicker(pixel,place,writes,word,opaque,composed,layers,relax,relaxing&&thinAntiFlickers(),scale);}
 let cellError=flick.error;`

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
 let boxes=minMaxPair(exposedInput,exposedHistory);
 let inputBox=boxes.first;
 var visible:array<bool,${LANE_ROWS}>;
 for(var r=0;r<${LANE_ROWS};r++){
  visible[r]=luma601(${cast('vec3f', 'inputBox.hi[r].rgb-inputBox.lo[r].rgb')})>${SPATIAL_ANTI_ALIASER_MIN_LUMINANCE};
 }
 let heldHistory=heldIn(exposedHistory,inputBox);
 let heldBoxes=minMaxPair(heldHistory,heldIn(exposedInput,boxes.second));
 let heldInput=heldIn(exposedInput,heldBoxes.first);
 let historyHeld=heldIn(exposedHistory,heldBoxes.second);
 let flickerOn=flickerRejects();
 let measured=measureRejection(exposedInput,heldInput,historyHeld,cellError,relax,relaxing,flickerOn);
 var blend=measured.blend;var clampBlend=measured.clampBlend;
 var resurrect:array<bool,${LANE_ROWS}>;`

/** The resurrected frame's rejection, measured where some texel of the workgroup is closer. */
const resurrectText = ({ F, V4 }: RejectionTypes) => ` if(resurrecting){
  var worth=false;
  for(var r=0;r<${LANE_ROWS};r++){worth=worth||(closer[r]&&blend[r]<${wgslF32(NOT_GOOD_ENOUGH)}&&inner[r]);}
  if(anyThread(worth)){
   var exposedOther:Px;
   for(var r=0;r<${LANE_ROWS};r++){exposedOther[r]=${V4}(other[r].rgb*other[r].rgb,0.0);}
   let otherBoxes=minMaxPair(exposedOther,heldIn(exposedOther,inputBox));
   let otherInput=heldIn(exposedInput,otherBoxes.second);
   let otherHistory=annihilateToGuide(exposedOther,exposedInput,otherBoxes.first);
   var none:array<${F},${LANE_ROWS}>;
   let fromOther=measureRejection(exposedInput,otherInput,otherHistory,none,none,false,flickerOn);
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
  if(analysisShown()){
   words=analysisView(u32(view.params.w),g,w,${cast('f32', 'cellError[r]')},${cast('f32', 'flick.count[r]')},${['measured.plain[r]', 'measured.raw[r]', 'blend[r]'].map((e) => cast('f32', e)).join(',')});
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
    flickerReadText(),
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
 * - The flicker measure (`flickerMeasureWgsl.ts`), first, where the level rejects by it
 *   (`view.quality.x`) or an analysis view is shown: its error at each texel of the tile, none
 *   otherwise, and the flicker history it writes. The rejection widens by the error.
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
 * once per texel of the tile; the flicker measure's error, the marks and the thin geometry mask where
 * the steps that read them run.
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
      FLICKER_GATES_WGSL,
      LUMA_601_WGSL,
      antiAliasMaskWgsl(maskForm, 'write'),
      REPROJECTED_WORD_WGSL,
      RESURRECTION_WGSL,
      TRANSLUCENCY_WGSL,
      measureWgsl(p, wave),
      flickerMeasureWgsl(rejectionTypes(p), wave),
      safeRcp,
    ],
  )
}
