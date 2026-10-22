import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import {
  COLOR_SPACES_WGSL,
  DISPLAY_STEP_ERROR,
  DITHER_WGSL,
  LARGEST_SCENE_COLOR,
  LARGEST_SMALL_FLOAT,
  LUMA_TO_CHANNEL,
  quantizationError,
} from './colorSpaceWgsl.ts'
import { REPROJECT_BITS, REPROJECTED_WORD_WGSL, SHADING_HISTORY_FORMAT } from './reprojectWgsl.ts'
import { SHARE_CODE_MASK } from './velocityWgsl.ts'
import { FILTERING_WEIGHT } from './flickerStages.ts'
import { THIN_COVERAGE_BITS, THIN_MASK_BITS, THIN_RUNS } from './thinGeometryWgsl.ts'
import { SAFE_RCP_WGSL } from './historyWgsl.ts'
import {
  ANTI_ALIAS_BIT,
  LDR_LUMA_FORMAT,
  LUMA_601_WGSL,
  SPATIAL_ANTI_ALIASER_MIN_LUMINANCE,
} from './spatialAntiAliasingWgsl.ts'
import {
  NINE_OPERATORS_WGSL,
  TILE_CLAMP_WGSL,
  TILE_WORDS_WGSL,
  tileEntry,
  tileRegion,
  tileStage,
  tileWithin,
  tileWords,
  type TilePlan,
} from './tileWgsl.ts'

/** The held measure's tile and the border its chain of five 3×3 operators reads: 16×8, the widest
 *  whose colour network fits the workgroup memory every device holds. */
export const HELD_MEASURE_PLAN: TilePlan = { width: 16, height: 8, border: 5 }

/** Its bindings. */
export const HELD_MEASURE_BINDINGS = {
  view: 0,
  current: 1,
  word: 2,
  shading: 3,
  filteredInput: 4,
  filteredHistory: 5,
  filteredError: 6,
  occluders: 7,
} as const

/** The held measure of each render texel, three targets of half floats, each colour beside a
 *  channel of the held input's 3×3 box size: the filtered input — its box size's sign the aliasing
 *  visible —, the filtered history, the clamp error's floor (`heldMeasureShader`). */
export const HELD_MEASURE_FORMAT: GPUTextureFormat = 'rgba16float'

/** The shading rejection's tile and the border its chain of four 3×3 operators reads. */
export const REJECTION_PLAN: TilePlan = { width: 16, height: 16, border: 4 }

/** Its bindings. */
export const REJECTION_BINDINGS = {
  view: 0,
  current: 1,
  word: 2,
  shading: 3,
  flicker: 4,
  shadingOut: 5,
  rejection: 6,
  luma: 7,
  flickerHistory: 8,
  reactive: 9,
  marks: 10,
  thin: 11,
  filteredInput: 12,
  filteredHistory: 13,
  filteredError: 14,
} as const

/**
 * The analysis views (`view.params.w`, `taa` of `LIT_VIEWS`,
 * `../../visibility/shader/shadeMode.ts`), from the first: the rejection's words of a texel hold, in
 * place of its own, three of the factors that can take its history away, which the resolve shows
 * raw (`resolveWgsl.ts`); the analysis and the shading history stay those of the beauty image.
 * - 4, the flicker measure: its error (eight times), its count (of its most), the transparents'
 *   coverage that discounts it (the reactive value);
 * - 5, the shading rejection: without the flicker error's widening, with it, then spread — the
 *   factor the history update applies;
 * - 6, the reprojection: disoccluded, hole-filled with the occluder's velocity, off screen;
 * - 7, the motion: how far the texel moves to the flicker measure (`marks`), a pixel animation, the
 *   reprojection edge (one where the velocity is flat);
 * - 8, the thin geometry (`thinGeometryWgsl.ts`): the history relaxation weight, the cluster hole
 *   region, the coverage history.
 * Off, two uniform branches never taken.
 */
export const FIRST_ANALYSIS_VIEW = 4

/** The shading rejection of each render texel: the low frequency rejection, the clamp's lift,
 *  the validity's drop (stored as its complement) and the bits — the history kept (not
 *  disoccluded), the spatial anti-aliaser asked (`ANTI_ALIAS_BIT`), and the code of the most of its
 *  history the texel's surface keeps (`SHARE_CODE_SHIFT`, the history update's). */
export const REJECTION_FORMAT: GPUTextureFormat = 'rgba8unorm'

/** The bit of a texel whose history is kept, not disoccluded. */
const KEPT_BIT = 1
/** The half step an eight-bit store rounds by, which the rejection's words are biased against. */
const HALF_STEP = quantizationError(REJECTION_FORMAT) / 2

/** The binomial weight of the `n`-th texel of a 3×3, row-major from the upper left; what a texel
 *  adds to the blur of the rejection's input; the largest input a texel holds: one declaration both
 *  the held measure and the rejection list, each reading its own `view`. */
const BLUR_WEIGHT_WGSL = wgslBlock(
  'BLUR_WEIGHT_WGSL',
  [],
  `fn blurWeight(n:i32)->f32{return select(0.5,0.25,n%3!=1)*select(0.5,0.25,n/3!=1);}
/** What a texel of colour \`colour\` adds to the blur of the rejection's input: an animated one its
 *  colour, any other none and a whole transmittance. */
fn blurInput(colour:vec3f,animated:bool)->vec4f{return select(vec4f(0.0,0.0,0.0,1.0),vec4f(colour,0.0),animated);}
fn inputMost()->f32{return ${wgslF32(LARGEST_SCENE_COLOR)}/view.exposure.x;}`,
)

/**
 * The held measure, per render texel, the shading rejection's first half (`rejectionShader`): the
 * input and the history each held onto the other, filtered, and what the clamp needs of them.
 * - The input for the rejection: the image's colour; where a pixel animation lies in its 3×3, the
 *   3×3 blur of the animated colours over the others' own (no sharp colour), so its moving detail
 *   is measured as a whole. The history: the shading history (`reprojectWgsl.ts`), squared back to
 *   the measurement space. Every colour in the measurement space (`linearToMeasure`), exposed.
 * - Per channel: the input held within the 3×3 of the history held within the input's box; the
 *   history held within the 3×3 of the input held within the history's — each brought onto the
 *   other where they overlap, so a stroke the jitter moved by a pixel is no difference.
 * - Written: both blurred (the filtered input and history); the held input's 3×3 box size; the
 *   floor of the clamp error, the display's rounding or the blur of the least total variation of
 *   the input and of its difference to the held input; whether aliasing is visible — the input's
 *   3×3 box above the anti-aliaser's luma contrast —, in the sign of the box size's first channel.
 * The three channels run together, two colours a texel over three planes of half-float pairs.
 * Loads per span texel: the colour and the reprojection word, then the shading history; three
 * stores per written texel.
 *
 * The reprojection, the last reader of the closest occluder words (`velocityWgsl.ts`), ran in a
 * dispatch before, and this one runs at every level: each lane empties its texel's word — and its
 * second under an orthographic projection — so the next image's scatter starts from none, with no
 * clear between the dispatches; one store a texel, two under an orthographic projection.
 */
export const heldMeasureShader = () => {
  const plan = HELD_MEASURE_PLAN
  // The regions (`tileRegion`), each named by what it holds; a dead one lends its words: the colour
  // and its animation, then the input clamped to the history's box and the history to the input's,
  // then the filtered input, the least variation and the filtered history; the input and the
  // history, then both held; the aliasing; the input's difference to its held self.
  const opaque = tileRegion(plan, 5, 2)
  const crossed = tileRegion(plan, 3, 3)
  const blurred = tileRegion(plan, 1, 5)
  const colours = tileRegion(plan, 4, 3, opaque.end)
  const aliasing = tileRegion(plan, 0, 1, colours.end)
  const differences = tileRegion(plan, 2, 2, aliasing.end)
  if (crossed.end > opaque.end || blurred.end > opaque.end) throw new Error('TAA_HELD_REGIONS')
  const near = (region: typeof colours, k: string) => `nearWord(${k},n,${region.side})`
  const Q = wgslF32(DISPLAY_STEP_ERROR)
  return wgslProgram(
    `@group(0) @binding(${HELD_MEASURE_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${HELD_MEASURE_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${HELD_MEASURE_BINDINGS.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${HELD_MEASURE_BINDINGS.shading}) var shading:texture_2d<f32>;
@group(0) @binding(${HELD_MEASURE_BINDINGS.filteredInput}) var inputOut:texture_storage_2d<${HELD_MEASURE_FORMAT},write>;
@group(0) @binding(${HELD_MEASURE_BINDINGS.filteredHistory}) var historyOut:texture_storage_2d<${HELD_MEASURE_FORMAT},write>;
@group(0) @binding(${HELD_MEASURE_BINDINGS.filteredError}) var errorOut:texture_storage_2d<${HELD_MEASURE_FORMAT},write>;
@group(0) @binding(${HELD_MEASURE_BINDINGS.occluders}) var<storage,read_write> occluders:array<u32>;
${tileWords(differences.end)}
${tileEntry(plan, 'heldMeasure')}
 let own=corner+vec2i(i32(lane%${plan.width}u),i32(lane/${plan.width}u));
 if(all(own<vec2i(view.render.xy))){
  let index=u32(own.y)*u32(view.render.x)+u32(own.x);
  occluders[index]=0u;
  if(view.radius.w!=0.0){occluders[u32(view.render.x)*u32(view.render.y)+index]=0u;}
 }
${tileStage(
  plan,
  5,
  `   let colour=textureLoad(current,c,0).rgb;
   let animated=isAnimated(reprojectedWord(c));
   let k=${opaque.index};
   putPair(k,colour.r,colour.g);putPair(k+${opaque.stride}u,colour.b,select(1.0,0.0,animated));`,
)}
${tileStage(
  plan,
  4,
  `   let k=${opaque.index};
   var taps:array<vec4f,9>;
   for(var n=0;n<9;n++){
    let s=${near(opaque, 'k')};let rg=pairAt(s);let ba=pairAt(s+${opaque.stride}u);
    taps[n]=blurInput(vec3f(rg,ba.x),ba.y==0.0);
   }
   let blur=blur9q(taps);
   let rg=pairAt(k);let ba=pairAt(k+${opaque.stride}u);
   let x=min(select(vec3f(rg,ba.x),vec3f(0.0),ba.y==0.0)*blur.a+blur.rgb,vec3f(inputMost()));
   let past=textureLoad(shading,c,0).rgb;
   putTriple(${colours.index},${colours.stride}u,linearToMeasure(x*view.exposure.x),past*past);`,
)}
${tileStage(
  plan,
  3,
  `   let k=${colours.index};
   var input:array<vec3f,9>;var past:array<vec3f,9>;
   for(var n=0;n<9;n++){let t=tripleAt(${near(colours, 'k')},${colours.stride}u);input[n]=t[0];past[n]=t[1];}
   let inputLo=min9c(input);let inputHi=max9c(input);
   putTriple(${crossed.index},${crossed.stride}u,clamp(past[4],inputLo,inputHi),clamp(input[4],min9c(past),max9c(past)));
   if(${tileWithin(plan, 0)}){
    let range=inputHi-inputLo;
    tileWords[${aliasing.index}]=bitcast<u32>(range.r*0.299+range.g*0.587+range.b*0.114);
   }`,
)}
${tileStage(
  plan,
  2,
  `   let kc=${crossed.index};
   var x:array<vec3f,9>;var y:array<vec3f,9>;
   for(var n=0;n<9;n++){let t=tripleAt(${near(crossed, 'kc')},${crossed.stride}u);x[n]=t[0];y[n]=t[1];}
   let k=${colours.index};let own=tripleAt(k,${colours.stride}u);
   let heldInput=clamp(own[0],min9c(x),max9c(x));
   putTriple(k,${colours.stride}u,heldInput,clamp(own[1],min9c(y),max9c(y)));
   let gap=abs(own[0]-heldInput);
   let kd=${differences.index};putPair(kd,gap.r,gap.g);putPair(kd+${differences.stride}u,gap.b,0.0);`,
)}
${tileStage(
  plan,
  1,
  `   let k=${colours.index};let kd=${differences.index};
   var held:array<vec3f,9>;var past:array<vec3f,9>;var gap:array<vec3f,9>;
   for(var n=0;n<9;n++){
    let t=tripleAt(${near(colours, 'k')},${colours.stride}u);held[n]=t[0];past[n]=t[1];
    let s=${near(differences, 'kd')};gap[n]=vec3f(pairAt(s),pairAt(s+${differences.stride}u).x);
   }
   let kb=${blurred.index};
   putTriple(kb,${blurred.stride}u,blur9c(held),min(abs(variation9c(gap)),abs(variation9c(held))));
   let history=blur9c(past);
   putPair(kb+${3 * blurred.stride}u,history.r,history.g);putPair(kb+${4 * blurred.stride}u,history.b,0.0);`,
)}
${tileStage(
  plan,
  0,
  `   let kb=${blurred.index};let k=${colours.index};
   var variation:array<vec3f,9>;var held:array<vec3f,9>;
   for(var n=0;n<9;n++){
    variation[n]=tripleAt(${near(blurred, 'kb')},${blurred.stride}u)[1];
    held[n]=tripleAt(${near(colours, 'k')},${colours.stride}u)[0];
   }
   let size=max9c(held)-min9c(held);
   let errorFloor=max(vec3f(${Q}),blur9c(variation));
   let input=tripleAt(kb,${blurred.stride}u)[0];
   let history=vec3f(pairAt(kb+${3 * blurred.stride}u),pairAt(kb+${4 * blurred.stride}u).x);
   let visible=bitcast<f32>(tileWords[${aliasing.index}])>${SPATIAL_ANTI_ALIASER_MIN_LUMINANCE};
   if(all(g<vec2i(view.render.xy))){
    textureStore(inputOut,g,vec4f(input,select(size.r,-size.r,visible)));
    textureStore(historyOut,g,vec4f(history,size.g));
    textureStore(errorOut,g,vec4f(errorFloor,size.b));
   }`,
  true,
)}
}`,
    [
      TAA_VIEW_WGSL,
      COLOR_SPACES_WGSL,
      REPROJECTED_WORD_WGSL,
      BLUR_WEIGHT_WGSL,
      NINE_OPERATORS_WGSL,
      TILE_WORDS_WGSL,
      TILE_CLAMP_WGSL,
    ],
  )
}

/** The rejection's input of a texel, and the history relaxation weight the thin geometry detection
 *  gives it. */
const REJECTION_INPUT_WGSL = wgslBlock(
  'REJECTION_INPUT_WGSL',
  [],
  `/** The rejection's input of colour \`colour\` and reprojection word \`word\` at texel \`c\`: where
 *  a pixel animation may lie in its 3×3 (\`blurred\`), the 3×3 blur of the animated colours over
 *  its own, read again from the textures. */
fn rejectionInput(c:vec2i,colour:vec3f,word:u32,blurred:bool)->vec3f{
 if(!blurred){return min(colour,vec3f(inputMost()));}
 var blur=vec4f(0.0);
 for(var n=0;n<9;n++){
  let at=clampTexel(c+vec2i(n%3-1,n/3-1));
  blur+=blurInput(textureLoad(current,at,0).rgb,isAnimated(reprojectedWord(at)))*blurWeight(n);
 }
 return min(select(colour,vec3f(0.0),isAnimated(word))*blur.a+blur.rgb,vec3f(inputMost()));
}
/** The history relaxation weight the thin geometry detection gives texel \`c\`, none up to one
 *  127th. */
fn relaxationOf(c:vec2i)->f32{
 let mask=textureLoad(thin,c,0).g>>${THIN_MASK_BITS.shift}u;
 return select(0.0,f32(mask)/${THIN_MASK_BITS.most}.0,mask>1u);
}`,
)

/**
 * The shading rejection, per render texel, after the flicker measure (`flickerWgsl.ts`) and the
 * held measure (`heldMeasureShader`): how far the history disagrees with the image in shading,
 * measured where it can be seen and blurred enough that the jitter's own noise is no disagreement.
 * - Per channel, of the held measure: the filtered input's 3×3 box; where the thin geometry
 *   detection relaxes the history (`thinGeometryWgsl.ts`, its weight past one 127th), the box
 *   moved toward the filtered history's 3×3 box by that weight, the filtered history held in it,
 *   and the box of that held history over the 3×3. The clamp error, its floor or a quarter of the
 *   filtering weight of the held input's box size, plus the display's rounding; the box widened by
 *   the clamp error, and by the flicker error at three times the luma's swing; the box's size, the
 *   filtering weight of the held input's box plus twice the rounding's, at least the flicker
 *   error's share of the channel's clamp.
 * - The history's energy past the box against the larger of the filtered input-history difference
 *   and that size: the raw rejection, the least of the channels'; the 3×3 median of the energy and
 *   of the rejection, their 3×3 maximum (the energy) and minimum (the rejection, the clamp's lift);
 *   the rejection again from the spread energy, the least of the channels'.
 * - The shading history updated for the next image, in a perception space, at the rejection's
 *   blend factor — at least the factor a whole history takes the image at, in full where the
 *   history is rejected or disoccluded —, dithered to its eight bits, beside the reprojection edge.
 * - The clamp's lift for the history update: none where disoccluded, else the least of the clamp's
 *   lift, the reprojection edge and the shading history's edges over the 3×3; the validity's drop
 *   as far as the clamp holds. Whether the anti-aliaser runs: aliasing visible (the held measure)
 *   where the history is rejected below a quarter or disoccluded.
 * - The LDR luma the anti-aliaser browses (`spatialAntiAliasingWgsl.ts`).
 * Loads per span texel: the filtered input and history and the reprojection word; the thin
 * geometry mask, the held measure's three words and the flicker error at the texels the middle
 * stages read, the shading history's edge at the second last; the written texels the colour, the
 * shading history, the reprojection word and the filtered input again. Where the thin geometry
 * detection does not run (`view.quality.w`), its mask reads none: the relaxation's stage is left
 * out and the box is the input's alone.
 */
export const rejectionShader = () => {
  const plan = REJECTION_PLAN
  // The regions (`tileRegion`), each named by what it holds; a dead one lends its words: the
  // filtered input and history, then their medians beside the shading history's edge; the history
  // held in the relaxed box and the relaxation weight; the energy and the rejection; the delta.
  const filtered = tileRegion(plan, 4, 3)
  const medians = tileRegion(plan, 1, 2)
  const edges = tileRegion(plan, 1, 1, medians.end)
  const relaxed = tileRegion(plan, 3, 2, filtered.end)
  const energy = tileRegion(plan, 2, 2, relaxed.end)
  const deltas = tileRegion(plan, 0, 2, energy.end)
  if (edges.end > filtered.end) throw new Error('TAA_REJECTION_REGIONS')
  const near = (region: typeof filtered, k: string) => `nearWord(${k},n,${region.side})`
  const Q = wgslF32(DISPLAY_STEP_ERROR)
  return wgslProgram(
    `@group(0) @binding(${REJECTION_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${REJECTION_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${REJECTION_BINDINGS.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${REJECTION_BINDINGS.shading}) var shading:texture_2d<f32>;
@group(0) @binding(${REJECTION_BINDINGS.flicker}) var flicker:texture_2d<u32>;
@group(0) @binding(${REJECTION_BINDINGS.shadingOut}) var shadingOut:texture_storage_2d<${SHADING_HISTORY_FORMAT},write>;
@group(0) @binding(${REJECTION_BINDINGS.rejection}) var rejectionOut:texture_storage_2d<${REJECTION_FORMAT},write>;
@group(0) @binding(${REJECTION_BINDINGS.luma}) var lumaOut:texture_storage_2d<${LDR_LUMA_FORMAT},write>;
@group(0) @binding(${REJECTION_BINDINGS.flickerHistory}) var flickerHistory:texture_2d<f32>;
@group(0) @binding(${REJECTION_BINDINGS.reactive}) var reactive:texture_2d<f32>;
@group(0) @binding(${REJECTION_BINDINGS.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${REJECTION_BINDINGS.thin}) var thin:texture_2d<u32>;
@group(0) @binding(${REJECTION_BINDINGS.filteredInput}) var filteredInput:texture_2d<f32>;
@group(0) @binding(${REJECTION_BINDINGS.filteredHistory}) var filteredHistory:texture_2d<f32>;
@group(0) @binding(${REJECTION_BINDINGS.filteredError}) var filteredError:texture_2d<f32>;
${tileWords(deltas.end, 4)}
var<workgroup> anyAnimated:atomic<u32>;
/** The words of analysis view \`mode\` (\`FIRST_ANALYSIS_VIEW\`) of texel \`c\`, its reprojection
 *  word \`word\`, edge \`edge\` and spread rejection \`rejected\`; \`ke\`, \`kd\` its energy and
 *  delta words. */
fn analysisView(mode:u32,c:vec2i,word:u32,edge:f32,rejected:f32,ke:u32,kd:u32)->vec3f{
 let bit=vec3u(${REPROJECT_BITS.disoccluded}u,${REPROJECT_BITS.filled}u,${REPROJECT_BITS.offScreen}u);
 if(mode==${FIRST_ANALYSIS_VIEW}u){
  let count=textureLoad(flickerHistory,c,0).w;
  let cover=textureLoad(reactive,min(c,vec2i(textureDimensions(reactive))-vec2i(1)),0).g;
  return vec3f(saturate(bitcast<f32>(textureLoad(flicker,c,0).r)*8.0),count,cover);
 }
 if(mode==${FIRST_ANALYSIS_VIEW + 1}u){return vec3f(pairAt(kd+${deltas.stride}u).y,pairAt(ke+${energy.stride}u).y,rejected);}
 if(mode==${FIRST_ANALYSIS_VIEW + 2}u){return select(vec3f(0.0),vec3f(1.0),(vec3u(word)&bit)!=vec3u(0u));}
 if(mode==${FIRST_ANALYSIS_VIEW + 4}u){
  let t=textureLoad(thin,c,0);
  let weight=f32(t.g>>${THIN_MASK_BITS.shift}u)/${THIN_MASK_BITS.most}.0;
  return vec3f(weight,f32(t.g&${THIN_MASK_BITS.clusterHole}u),f32(t.r>>${THIN_COVERAGE_BITS.shift}u)/${THIN_COVERAGE_BITS.most}.0);
 }
 return vec3f(f32(textureLoad(marks,c,0).b)/255.0,select(0.0,1.0,isAnimated(word)),edge);
}
${tileEntry(plan, 'shadingRejection')}
${tileStage(
  plan,
  4,
  `   if(isAnimated(reprojectedWord(c))){atomicOr(&anyAnimated,1u);}
   putTriple(${filtered.index},${filtered.stride}u,textureLoad(filteredInput,c,0).rgb,textureLoad(filteredHistory,c,0).rgb);`,
)}
${tileStage(
  plan,
  3,
  `   let k=${filtered.index};
   var input:array<vec3f,9>;var history:array<vec3f,9>;
   for(var n=0;n<9;n++){let t=tripleAt(${near(filtered, 'k')},${filtered.stride}u);input[n]=t[0];history[n]=t[1];}
   // The box moved toward the filtered history's by the relaxation weight, the history held in it.
   let weight=relaxationOf(c);
   let lo=mix(min9c(input),min9c(history),vec3f(weight));
   let hi=mix(max9c(input),max9c(history),vec3f(weight));
   let held=clamp(history[4],lo,hi);
   let kr=${relaxed.index};
   putPair(kr,held.r,held.g);putPair(kr+${relaxed.stride}u,held.b,weight);`,
  false,
  THIN_RUNS,
)}
${tileStage(
  plan,
  2,
  `   let k=${filtered.index};let kr=${relaxed.index};
   var input:array<vec3f,9>;var held:array<vec3f,9>;
   for(var n=0;n<9;n++){
    input[n]=tripleAt(${near(filtered, 'k')},${filtered.stride}u)[0];
    let s=${near(relaxed, 'kr')};held[n]=vec3f(pairAt(s),pairAt(s+${relaxed.stride}u).x);
   }
   let relaxedHere=pairAt(kr+${relaxed.stride}u).y>0.0;
   let box0=select(min9c(input),min9c(held),relaxedHere);
   let box1=select(max9c(input),max9c(held),relaxedHere);
   let history=tripleAt(k,${filtered.stride}u)[1];
   let first=textureLoad(filteredInput,c,0);let second=textureLoad(filteredHistory,c,0);let third=textureLoad(filteredError,c,0);
   let size=vec3f(abs(first.a),second.a,third.a);
   let error=max(third.rgb,size*${wgslF32(FILTERING_WEIGHT * 0.25)})+${Q};
   let boxLo=box0-error;let boxHi=box1+error;
   // The flicker error, where the level rejects by it (view.quality.x): elsewhere the measure
   // did not run, and its word holds no error (analysis.ts).
   let flickerError=select(0.0,bitcast<f32>(textureLoad(flicker,c,0).r),view.quality.x>0.0);
   let spread=${LUMA_TO_CHANNEL}.0*flickerError;
   let clamped=clamp(history,min(boxLo,boxHi-spread),max(boxHi,boxLo+spread));
   let energy=abs(clamped-history);
   let amount=energy*safeRcp(energy.x+energy.y+energy.z);
   let least=max(size*${wgslF32(FILTERING_WEIGHT)}+${wgslF32(2 * FILTERING_WEIGHT * DISPLAY_STEP_ERROR)},amount*(${wgslF32(FILTERING_WEIGHT * LUMA_TO_CHANNEL)}*flickerError));
   let delta=max(abs(first.rgb-history),least);
   let factor=saturate(vec3f(1.0)-energy/delta);
   let ke=${energy.index};
   putPair(ke,energy.x,energy.y);putPair(ke+${energy.stride}u,energy.z,min(factor.x,min(factor.y,factor.z)));
   // The analysis view of the rejection: the factor without the flicker error's widening.
   var plain=0.0;
   if(view.params.w==${FIRST_ANALYSIS_VIEW + 1}.0){
    let plainEnergy=abs(clamp(history,boxLo,boxHi)-history);
    let plainFactor=saturate(vec3f(1.0)-plainEnergy/max(abs(first.rgb-history),size*${wgslF32(FILTERING_WEIGHT)}+${wgslF32(2 * FILTERING_WEIGHT * DISPLAY_STEP_ERROR)}));
    plain=min(plainFactor.x,min(plainFactor.y,plainFactor.z));
   }
   if(${tileWithin(plan, 0)}){let kd=${deltas.index};putPair(kd,delta.x,delta.y);putPair(kd+${deltas.stride}u,delta.z,plain);}`,
)}
${tileStage(
  plan,
  1,
  `   let k=${energy.index};
   var e:array<vec4f,9>;
   for(var n=0;n<9;n++){let s=${near(energy, 'k')};e[n]=vec4f(pairAt(s),pairAt(s+${energy.stride}u));}
   let median=median9q(e);
   let km=${medians.index};putPair(km,median.x,median.y);putPair(km+${medians.stride}u,median.z,median.w);
   tileWords[${edges.index}]=bitcast<u32>(textureLoad(shading,c,0).a);`,
)}
${tileStage(
  plan,
  0,
  `   let km=${medians.index};let kx=${edges.index};
   var m:array<vec4f,9>;var historyEdge=1.0;
   for(var n=0;n<9;n++){
    let s=${near(medians, 'km')};m[n]=vec4f(pairAt(s),pairAt(s+${medians.stride}u));
    historyEdge=min(historyEdge,bitcast<f32>(tileWords[${near(edges, 'kx')}]));
   }
   let spread=max9q(m).xyz;
   let clampLift=min9q(m).w;
   let kd=${deltas.index};
   let delta=vec3f(pairAt(kd),pairAt(kd+${deltas.stride}u).x);
   let factor=saturate(vec3f(1.0)-spread/delta);
   let rejected=min(factor.x,min(factor.y,factor.z));
   let word=reprojectedWord(c);
   let restarted=isRestarted(word);
   let edge=reprojectionEdge(word);
   let lift=select(min(clampLift,min(edge,historyEdge)),0.0,restarted);
   let raise=select(clampLift,0.0,restarted);
   let visible=(bitcast<u32>(textureLoad(filteredInput,c,0).a)>>31u)!=0u;
   // The spatial anti-aliaser, where the level runs one (view.quality.y).
   let antiAlias=view.quality.y>0.0&&visible&&(rejected<0.25||restarted);
   let colour=textureLoad(current,c,0).rgb;
   let input=rejectionInput(c,colour,word,atomicLoad(&anyAnimated)!=0u);
   let past=textureLoad(shading,c,0);
   let total=select(saturate(1.0-rejected*4.0),1.0,restarted);
   let blend=max(max(view.rates.y,1.0-rejected),total);
   let exposedInput=addPerception(input*view.exposure.x,1.0);
   let exposedPast=addPerception(perceptualToLinear(past.rgb),1.0);
   let updated=linearToPerceptual(removePerception(exposedInput*blend-exposedPast*(blend-1.0),1.0));
   let shown=min(colour,vec3f(${wgslF32(LARGEST_SMALL_FLOAT)})/view.exposure.x)*view.exposure.x;
   let luma=luma601(shown);
   if(all(g<vec2i(view.render.xy))){
    textureStore(shadingOut,g,vec4f(ditherUnorm(updated,frameRandom(g,u32(view.jitter.w)).x,${wgslF32(quantizationError(SHADING_HISTORY_FORMAT))}),edge));
    let bits=select(${KEPT_BIT}u,0u,restarted)|select(0u,${ANTI_ALIAS_BIT}u,antiAlias)|(word&${SHARE_CODE_MASK}u);
    var words=vec3f(rejected-${wgslF32(HALF_STEP)},lift-${wgslF32(HALF_STEP)},${wgslF32(1 - HALF_STEP)}-raise);
    if(view.params.w>=${FIRST_ANALYSIS_VIEW}.0){words=analysisView(u32(view.params.w),c,word,edge,rejected,${energy.index},kd);}
    textureStore(rejectionOut,g,vec4f(words,f32(bits)/255.0));
    textureStore(lumaOut,g,vec4f(luma/(0.5+luma),0.0,0.0,0.0));
   }`,
  true,
)}
}`,
    [
      TAA_VIEW_WGSL,
      COLOR_SPACES_WGSL,
      DITHER_WGSL,
      LUMA_601_WGSL,
      REPROJECTED_WORD_WGSL,
      SAFE_RCP_WGSL,
      BLUR_WEIGHT_WGSL,
      NINE_OPERATORS_WGSL,
      TILE_WORDS_WGSL,
      TILE_CLAMP_WGSL,
      REJECTION_INPUT_WGSL,
    ],
  )
}
