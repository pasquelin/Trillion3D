import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { DISPLAY_STEP_ERROR, FLICKER_LUMA_WGSL } from './colorSpaceWgsl.ts'
import { FLICKER_FORMAT, REPROJECTED_WORD_WGSL } from './reprojectWgsl.ts'
import { VECTOR_FORMAT } from './velocityWgsl.ts'
import { THIN_MASK_BITS } from './thinGeometryWgsl.ts'
import { SAFE_RCP_WGSL } from './historyWgsl.ts'
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

/** The flicker measure's tile and the border its chain of nine 3×3 operators reads: 16×8, the
 *  widest whose network fits the workgroup memory every device holds. */
export const FLICKER_PLAN: TilePlan = { width: 16, height: 8, border: 9 }

/** Its bindings. */
export const FLICKER_BINDINGS = {
  view: 0,
  current: 1,
  reactive: 2,
  word: 3,
  flicker: 4,
  marks: 5,
  flickerOut: 6,
  error: 7,
  occluders: 8,
  thin: 9,
} as const

/** The flicker error of each render texel, an f32's bits (`flickerShader`). */
export const FLICKER_ERROR_FORMAT = VECTOR_FORMAT

/** The share of the image a ghosting update of the flicker history takes, and the fade of its
 *  totals every image: 5 %. */
const FLICKER_GHOSTING = 0.05
/** A gradient is kept in eight bits: what lies within this is its rounding. */
const GRADIENT_EPSILON = 1 / 127
/** The most flickers the history counts, within its eight bits. */
const FLICKER_COUNT_MAX = 20
/** The flicker luma's eight-bit rounding, which its modification measure discounts. */
const LUMA_STEP_ERROR = 0.5 / 255
/** The filtering weight of the binomial 3×3's centre: `1 / (1 + 4·½ + 4·¼)`. */
export const FILTERING_WEIGHT = 1 / (1 + 4 * 0.5 + 4 * 0.25)
/** The flicker period, in images, below which a luma oscillation is a flicker. */
const FLICKER_PERIOD = 2
/** The periods a thin geometry region counts its flickers over (`thinGeometryWgsl.ts`). */
export const THIN_GEOMETRY_PERIODS = 3
/** A gradient past which a thin geometry region's flicker is one, however small. */
const THIN_GEOMETRY_GRADIENT = 0.00007
/** The refresh rate, in hertz, below which the period shortens with the frame rate. */
const FLICKER_FRAME_RATE_CAP = 60

/**
 * The flicker count's fade-in rate for a frame `intervalMs` long (`null`, unknown): `1 − 0.95^P`,
 * `P` the flicker period — two images, shortened in proportion where the frame rate falls below
 * 60 Hz, so an effect animated in time is not taken for a flicker at a low frame rate —, `periods`
 * of them (`THIN_GEOMETRY_PERIODS` in a thin geometry region).
 */
export function flickerCountRate(intervalMs: number | null, periods = 1) {
  const period = (periods * FLICKER_PERIOD) / Math.max(refreshShare(intervalMs), 1)
  return 1 - (1 - FLICKER_GHOSTING) ** period
}

/** The frame's length against the 60 Hz cap's: one when unknown. */
const refreshShare = (intervalMs: number | null) =>
  intervalMs !== null && intervalMs > 0 ? (intervalMs / 1000) * FLICKER_FRAME_RATE_CAP : 1

/** The parallax speed, in render pixels an image, past which a texel is moving to the flicker
 *  measure: ten pixels of a 1920-wide image at the 60 Hz cap, in proportion to the frame's length
 *  and the render width. Its inverse is what the uniform holds (`view.rates.x`). */
export const flickerParallaxInverse = (renderWidth: number, intervalMs: number | null) =>
  1 / (refreshShare(intervalMs) * 10 * (renderWidth / 1920))

/**
 * The flicker measure over time, per render texel, after the reprojection (`reprojectWgsl.ts`): a
 * luma that keeps swinging between images about a still surface — a moiré of fine geometry against
 * the jittered grid, a reflection's noise — widens the shading rejection's box by its swing
 * (`rejectionWgsl.ts`), so the history keeps it averaged instead of following it.
 * - The input luma in the measurement space (`flickerLumaMeasure`), and how far the image's own
 *   luma was modified past it — its eight-bit rounding aside — by the transparents drawn over it, at
 *   their coverage (the reactive value). The history (`reprojectWgsl.ts`): the flicker history's luma,
 *   the accumulated gradient, the total variation and its count, the latter two faded 5 % an image
 *   and dropped as far as the texel moves (`marks`).
 * - The shading rejection's own heuristic on this one channel: the input and the history each held
 *   within the other's 3×3 and blurred; the blurred input's 3×3 box — where the thin geometry
 *   relaxes the history (its weight past one 127th, `thinGeometryWgsl.ts`), moved toward the
 *   blurred history's 3×3 box by that weight, the blurred history held in it and the box of that
 *   held history over the 3×3 —, widened by the display's rounding and a quarter of the filtering
 *   weight of the input's own box; the history's energy past it, against the larger of the
 *   input-history difference and the box's size; the 3×3 median of that energy and of the
 *   rejection, then their 3×3 maximum and minimum.
 * - The history update replayed: the history held within the input's cross, lifted back as far as
 *   the clamp is, blended at the rejection's factor (at least 5 %); its gradient against a 5 %
 *   ghosting update, less the luma's modification. A flicker: the gradient and the accumulated one
 *   of opposite signs, both past the eight-bit rounding, never across a cut. Its smaller swing and
 *   its count, spread over 5×5 by their maxima, add to the totals; the accumulated gradient restarts
 *   on a flicker and adds up otherwise; a disocclusion restarts all; the count is quantised to its
 *   eight bits.
 * - In a thin geometry region — a texel whose history the thin geometry detection relaxes
 *   (`thinGeometryWgsl.ts`), its gradients one past 0.00007 and either within the rounding — the
 *   gradients count as a flicker, faded in over three flicker periods (`view.exposure.w`).
 * - The error: the mean swing plus the count times the rounding, faded in once the count holds the
 *   flicker period's fade-in (`view.exposure.z`), kept to still texels, less the luma's
 *   modification.
 * Written: the flicker history (the perceptual-space luma, the gradient, the total variation, the
 * count), and the error.
 *
 * The network runs in half-float pairs over 16×8 tiles: the lumas enter as their eight-bit steps,
 * exact, so the first operator reads them as the textures hold them; the luma modification and its
 * blur, the delta, the blended history and its gradient stay single floats. Loads per span texel:
 * the colour, the reactive value and the flicker history once; the relaxation's texels read the
 * thin geometry mask, the replay's the flicker history again and the mask, the written texels the
 * flicker history, the marks and the reprojection word.
 *
 * The reprojection, the last reader of the closest occluder words (`velocityWgsl.ts`), ran in a
 * dispatch before: each lane empties its texel's word — and its second under an orthographic
 * projection — so the next image's scatter starts from none, with no clear between the dispatches;
 * one store a texel, two under an orthographic projection.
 */
export const flickerShader = () => {
  const plan = FLICKER_PLAN
  // The regions, each named by what it holds, in the stages' order (`tileRegion`): the lumas, the
  // held then the blurred pair, the swing and its count; the luma modification, then the energy
  // and the rejection; the history held in the relaxed box beside the relaxation weight; the input
  // luma steps a cross reads; the blurred modification beside the
  // rejection's delta; the modification and the blended history and gradient of a written texel.
  const pairs = tileRegion(plan, 9, 1)
  const held = tileRegion(plan, 8, 1, pairs.end)
  const energy = tileRegion(plan, 4, 1, held.end)
  const blended = tileRegion(plan, 0, 2, held.end)
  const relaxed = tileRegion(plan, 5, 1, energy.end)
  const steps = tileRegion(plan, 3, 1, relaxed.end)
  const delta = tileRegion(plan, 2, 2, steps.end)
  const modified = tileRegion(plan, 0, 1, delta.end)
  if (blended.end > energy.end) throw new Error('TAA_FLICKER_REGIONS')
  const nine = (region: typeof pairs, k: string) =>
    ` var near:array<vec2f,9>;for(var n=0;n<9;n++){near[n]=pairAt(nearWord(${k},n,${region.side}));}`
  const Q = wgslF32(DISPLAY_STEP_ERROR)
  const G = wgslF32(FLICKER_GHOSTING)
  const keep = wgslF32(FLICKER_GHOSTING - 1)
  return wgslProgram(
    `@group(0) @binding(${FLICKER_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${FLICKER_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${FLICKER_BINDINGS.reactive}) var reactive:texture_2d<f32>;
@group(0) @binding(${FLICKER_BINDINGS.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${FLICKER_BINDINGS.flicker}) var flicker:texture_2d<f32>;
@group(0) @binding(${FLICKER_BINDINGS.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${FLICKER_BINDINGS.flickerOut}) var flickerOut:texture_storage_2d<${FLICKER_FORMAT},write>;
@group(0) @binding(${FLICKER_BINDINGS.error}) var errorOut:texture_storage_2d<${FLICKER_ERROR_FORMAT},write>;
@group(0) @binding(${FLICKER_BINDINGS.occluders}) var<storage,read_write> occluders:array<u32>;
@group(0) @binding(${FLICKER_BINDINGS.thin}) var thin:texture_2d<u32>;
${tileWords(modified.end)}
${tileEntry(plan, 'flickerMeasure')}
 let own=corner+vec2i(i32(lane%${plan.width}u),i32(lane/${plan.width}u));
 if(all(own<vec2i(view.render.xy))){
  let index=u32(own.y)*u32(view.render.x)+u32(own.x);
  occluders[index]=0u;
  if(view.radius.w!=0.0){occluders[u32(view.render.x)*u32(view.render.y)+index]=0u;}
 }
${tileStage(
  plan,
  9,
  `   let exposed=textureLoad(current,c,0).rgb*view.exposure.x;
   let lumaStep=flickerLumaStep(exposed);
   let cover=textureLoad(reactive,min(c,vec2i(textureDimensions(reactive))-vec2i(1)),0).g;
   let modification=max(max(abs(flickerLumaMeasure(lumaStep)-measureLuma(exposed))-${wgslF32(LUMA_STEP_ERROR)},0.0),cover);
   putPair(${pairs.index},lumaStep,round(textureLoad(flicker,c,0).x*255.0));
   if(${tileWithin(plan, 3)}){tileWords[${energy.index}]=bitcast<u32>(modification);tileWords[${steps.index}]=u32(lumaStep);}
   if(${tileWithin(plan, 0)}){tileWords[${modified.index}]=bitcast<u32>(modification);}`,
)}
${tileStage(
  plan,
  8,
  `   let k=${pairs.index};
   var lumas:array<vec2f,9>;
   for(var n=0;n<9;n++){let s=pairAt(nearWord(k,n,${pairs.side}))/255.0;lumas[n]=s*s;}
   let crossed=clamp(lumas[4].yx,min9p(lumas),max9p(lumas));
   putPair(${held.index},crossed.x,crossed.y);`,
)}
${tileStage(
  plan,
  7,
  `  ${nine(held, held.index)}
   let k=${pairs.index};let s=pairAt(k)/255.0;
   let kept=clamp(s*s,min9p(near),max9p(near));
   putPair(k,kept.x,kept.y);`,
)}
${tileStage(
  plan,
  6,
  `  ${nine(pairs, pairs.index)}
   let blurred=blur9p(near);
   putPair(${held.index},blurred.x,blurred.y);
   if(${tileWithin(plan, 2)}){
    let k=${energy.index};var m:array<f32,9>;
    for(var n=0;n<9;n++){m[n]=bitcast<f32>(tileWords[nearWord(k,n,${energy.side})]);}
    tileWords[${delta.index}]=bitcast<u32>(blur9(m));
   }`,
)}
${tileStage(
  plan,
  5,
  `  ${nine(held, held.index)}
   // The box moved toward the filtered history's by the thin geometry's relaxation weight, the
   // filtered history held in it.
   let mask=textureLoad(thin,c,0).g>>${THIN_MASK_BITS.shift}u;
   let weight=select(0.0,f32(mask)/${THIN_MASK_BITS.most}.0,mask>1u);
   let lo=mix(min9p(near).x,min9p(near).y,weight);let hi=mix(max9p(near).x,max9p(near).y,weight);
   putPair(${relaxed.index},clamp(near[4].y,lo,hi),weight);`,
)}
${tileStage(
  plan,
  4,
  `   let kh=${held.index};let kp=${pairs.index};let kr=${relaxed.index};
   var fi:array<f32,9>;var input:array<f32,9>;var heldHistory:array<f32,9>;
   for(var n=0;n<9;n++){
    fi[n]=pairAt(nearWord(kh,n,${held.side})).x;input[n]=pairAt(nearWord(kp,n,${pairs.side})).x;
    heldHistory[n]=pairAt(nearWord(kr,n,${relaxed.side})).x;
   }
   let filtered=pairAt(kh);
   let relaxedHere=pairAt(kr).y>0.0;
   let lo=select(min9(fi),min9(heldHistory),relaxedHere);let hi=select(max9(fi),max9(heldHistory),relaxedHere);
   let size=max9(input)-min9(input);
   let error=max(${Q},size*${wgslF32(FILTERING_WEIGHT * 0.25)})+${Q};
   let clamped=clamp(filtered.y,lo-error,hi+error);
   let gap=max(abs(filtered.x-filtered.y),size*${wgslF32(FILTERING_WEIGHT)}+${wgslF32(2 * FILTERING_WEIGHT * DISPLAY_STEP_ERROR)});
   let past=abs(clamped-filtered.y);
   putPair(${energy.index},past,saturate(1.0-past/gap));
   if(${tileWithin(plan, 2)}){tileWords[${delta.index}+${delta.stride}u]=bitcast<u32>(gap);}`,
)}
${tileStage(
  plan,
  3,
  `  ${nine(energy, energy.index)}
   let median=median9p(near);
   putPair(${pairs.index},median.x,median.y);`,
)}
${tileStage(
  plan,
  2,
  `  ${nine(pairs, pairs.index)}
   let clampBlend=min9p(near).y;
   let kd=${delta.index};
   let blurredModification=bitcast<f32>(tileWords[kd]);
   let blendFinal=saturate(1.0-max9p(near).x/bitcast<f32>(tileWords[kd+${delta.stride}u]));
   let ks=${steps.index};
   let input=flickerLumaMeasure(f32(tileWords[ks]));
   var lo=input;var hi=input;
   for(var n=1;n<9;n+=2){let v=flickerLumaMeasure(f32(tileWords[nearWord(ks,n,${steps.side})]));lo=min(lo,v);hi=max(hi,v);}
   let stored=textureLoad(flicker,c,0);
   let past=stored.x*stored.x;
   let pastKept=mix(clamp(past,lo,hi),past,clampBlend);
   let share=max(1.0-blendFinal,${G});
   let history=input*share-pastKept*(share-1.0);
   let ghost=input*${G}-past*${keep};
   var gradient=history-ghost;
   gradient=sign(gradient)*max(abs(gradient)-blurredModification,0.0);
   let prevGradient=stored.y*${wgslF32(255 / 127)}-1.0;
   let within=abs(gradient)<${wgslF32(GRADIENT_EPSILON)}||abs(prevGradient)<${wgslF32(GRADIENT_EPSILON)};
   // A thin geometry region: its relaxation weight past one 127th, a gradient, both within.
   let relaxed=(textureLoad(thin,c,0).g>>${THIN_MASK_BITS.shift}u)>1u;
   let thinRegion=relaxed&&(abs(gradient)>${wgslF32(THIN_GEOMETRY_GRADIENT)}||abs(prevGradient)>${wgslF32(THIN_GEOMETRY_GRADIENT)})&&within;
   let flickered=select(1.0,0.0,gradient*prevGradient>0.0||(within&&!thinRegion)||view.params.x!=0.0);
   putPair(${held.index},min(abs(prevGradient),abs(gradient))*flickered,flickered);
   if(${tileWithin(plan, 0)}){
    let k=${blended.index};
    // The history, never below zero, carries the thin geometry region in its sign bit.
    tileWords[k]=bitcast<u32>(history)|select(0u,0x80000000u,thinRegion);tileWords[k+${blended.stride}u]=bitcast<u32>(gradient);
   }`,
)}
${tileStage(
  plan,
  1,
  `  ${nine(held, held.index)}
   let most=max9p(near);
   putPair(${pairs.index},most.x,most.y);`,
)}
${tileStage(
  plan,
  0,
  `  ${nine(pairs, pairs.index)}
   let most=max9p(near);
   let stored=textureLoad(flicker,c,0);
   let still=1.0-f32(textureLoad(marks,c,0).b)/255.0;
   let prevGradient=stored.y*${wgslF32(255 / 127)}-1.0;
   let prevVariation=stored.z*${1 - FLICKER_GHOSTING}*still;
   let prevCount=stored.w*${wgslF32(FLICKER_COUNT_MAX * (1 - FLICKER_GHOSTING))}*still;
   let flickered=pairAt(${held.index}).y;
   let k=${blended.index};
   let history=bitcast<f32>(tileWords[k]&0x7fffffffu);
   let thinRegion=(tileWords[k]>>31u)!=0u;
   var gradient=prevGradient*${keep}*(flickered-1.0)+bitcast<f32>(tileWords[k+${blended.stride}u]);
   var total=prevVariation+most.x;
   var count=prevCount+most.y;
   if(isRestarted(reprojectedWord(c))){gradient=0.0;total=0.0;count=0.0;}
   let kept=floor(count*${wgslF32(255 / FLICKER_COUNT_MAX)})*${wgslF32(FLICKER_COUNT_MAX / 255)};
   let perCount=safeRcp(count);
   total=total*kept*perCount;
   let fade=saturate(count*select(view.exposure.z,view.exposure.w,thinRegion)-0.5);
   var error=(abs(total*perCount)+count*${wgslF32(GRADIENT_EPSILON)})*fade;
   error=saturate(error*still-bitcast<f32>(tileWords[${modified.index}]));
   if(all(g<vec2i(view.render.xy))){
    textureStore(flickerOut,g,vec4f(sqrt(max(history,0.0)),gradient*${wgslF32(127 / 255)}+${wgslF32(127 / 255)},total,kept/${FLICKER_COUNT_MAX}.0));
    textureStore(errorOut,g,vec4u(bitcast<u32>(error),0u,0u,0u));
   }`,
  true,
)}
}`,
    [
      TAA_VIEW_WGSL,
      FLICKER_LUMA_WGSL,
      REPROJECTED_WORD_WGSL,
      SAFE_RCP_WGSL,
      NINE_OPERATORS_WGSL,
      TILE_WORDS_WGSL,
      TILE_CLAMP_WGSL,
    ],
  )
}
