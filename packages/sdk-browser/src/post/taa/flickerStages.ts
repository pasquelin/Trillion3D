import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { DISPLAY_STEP_ERROR } from './colorSpaceWgsl.ts'
import { FLICKER_GHOSTING } from './flickerRates.ts'
import { THIN_MASK_BITS, THIN_RUNS } from './thinGeometryWgsl.ts'
import { tileRegion, tileStage, tileWithin, type TilePlan } from './tileWgsl.ts'

/** A gradient is kept in eight bits: what lies within this is its rounding. */
const GRADIENT_EPSILON = 1 / 127
/** The most flickers the history counts, within its eight bits. */
const FLICKER_COUNT_MAX = 20
/** The flicker luma's eight-bit rounding, which its modification measure discounts. */
const LUMA_STEP_ERROR = 0.5 / 255
/** The filtering weight of the binomial 3×3's centre: `1 / (1 + 4·½ + 4·¼)`. */
export const FILTERING_WEIGHT = 1 / (1 + 4 * 0.5 + 4 * 0.25)
/** A gradient past which a thin geometry region's flicker is one, however small. */
const THIN_GEOMETRY_GRADIENT = 0.00007

/**
 * The words of the flicker network's workgroup memory over `plan`, each region named by what it
 * holds, in the stages' order (`tileRegion`): the lumas, the held then the blurred pair, the swing
 * and its count; the luma modification, then the energy and the rejection; the history held in the
 * relaxed box beside the relaxation weight; the input luma steps a cross reads; the blurred
 * modification beside the rejection's delta; the modification and the blended history and gradient
 * of a written texel.
 */
export function flickerRegions(plan: TilePlan) {
  const pairs = tileRegion(plan, 9, 1)
  const held = tileRegion(plan, 8, 1, pairs.end)
  const energy = tileRegion(plan, 4, 1, held.end)
  const blended = tileRegion(plan, 0, 2, held.end)
  const relaxed = tileRegion(plan, 5, 1, energy.end)
  const steps = tileRegion(plan, 3, 1, relaxed.end)
  const delta = tileRegion(plan, 2, 2, steps.end)
  const modified = tileRegion(plan, 0, 1, delta.end)
  if (blended.end > energy.end) throw new Error('TAA_FLICKER_REGIONS')
  return { pairs, held, energy, blended, relaxed, steps, delta, modified }
}

/** What the flicker network's stages are written from: the tile's plan, its regions of workgroup
 *  memory, the load of the nine texels around a texel of a region (`nine`), and the constants the
 *  stages name. */
function stageContext(plan: TilePlan) {
  const regions = flickerRegions(plan)
  const nine = (region: typeof regions.pairs, k: string) =>
    ` var near:array<vec2f,9>;for(var n=0;n<9;n++){near[n]=pairAt(nearWord(${k},n,${region.side}));}`
  const Q = wgslF32(DISPLAY_STEP_ERROR)
  const G = wgslF32(FLICKER_GHOSTING)
  const keep = wgslF32(FLICKER_GHOSTING - 1)
  return { plan, ...regions, nine, Q, G, keep }
}
type Context = ReturnType<typeof stageContext>

/** The stages that make the luma of the image and its history, and cross them: the input luma and
 *  its modification, the held lumas, their kept and blurred pairs, and the swing's delta. */
const lumaStages = ({ plan, pairs, held, energy, steps, delta, modified, nine }: Context) =>
  [
    tileStage(
      plan,
      9,
      `   let exposed=textureLoad(current,c,0).rgb*view.exposure.x;
   let lumaStep=flickerLumaStep(exposed);
   let cover=textureLoad(reactive,min(c,vec2i(textureDimensions(reactive))-vec2i(1)),0).g;
   let modification=max(max(abs(flickerLumaMeasure(lumaStep)-measureLuma(exposed))-${wgslF32(LUMA_STEP_ERROR)},0.0),cover);
   putPair(${pairs.index},lumaStep,round(textureLoad(flicker,c,0).x*255.0));
   if(${tileWithin(plan, 3)}){tileWords[${energy.index}]=bitcast<u32>(modification);tileWords[${steps.index}]=u32(lumaStep);}
   if(${tileWithin(plan, 0)}){tileWords[${modified.index}]=bitcast<u32>(modification);}`,
    ),
    tileStage(
      plan,
      8,
      `   let k=${pairs.index};
   var lumas:array<vec2f,9>;
   for(var n=0;n<9;n++){let s=pairAt(nearWord(k,n,${pairs.side}))/255.0;lumas[n]=s*s;}
   let crossed=clamp(lumas[4].yx,min9p(lumas),max9p(lumas));
   putPair(${held.index},crossed.x,crossed.y);`,
    ),
    tileStage(
      plan,
      7,
      `  ${nine(held, held.index)}
   let k=${pairs.index};let s=pairAt(k)/255.0;
   let kept=clamp(s*s,min9p(near),max9p(near));
   putPair(k,kept.x,kept.y);`,
    ),
    tileStage(
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
    ),
  ].join('\n')

/** The stages of the history's relaxation and the rejection's heuristic on this one channel, and the
 *  median of its energy. */
const energyStages = ({ plan, pairs, held, energy, relaxed, delta, nine, Q }: Context) =>
  [
    tileStage(
      plan,
      5,
      `  ${nine(held, held.index)}
   // The box moved toward the filtered history's by the thin geometry's relaxation weight, the
   // filtered history held in it.
   let mask=textureLoad(thin,c,0).g>>${THIN_MASK_BITS.shift}u;
   let weight=select(0.0,f32(mask)/${THIN_MASK_BITS.most}.0,mask>1u);
   let lo=mix(min9p(near).x,min9p(near).y,weight);let hi=mix(max9p(near).x,max9p(near).y,weight);
   putPair(${relaxed.index},clamp(near[4].y,lo,hi),weight);`,
      false,
      THIN_RUNS,
    ),
    tileStage(
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
    ),
    tileStage(
      plan,
      3,
      `  ${nine(energy, energy.index)}
   let median=median9p(near);
   putPair(${pairs.index},median.x,median.y);`,
    ),
  ].join('\n')

/** The stage that replays the history update: the history held within the input's cross, blended at
 *  the rejection's factor, its gradient against a ghosting update, and what is a flicker. */
const replayStage = ({ plan, pairs, held, blended, steps, delta, nine, G, keep }: Context) =>
  tileStage(
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
   let relaxed=${THIN_RUNS}&&(textureLoad(thin,c,0).g>>${THIN_MASK_BITS.shift}u)>1u;
   let thinRegion=relaxed&&(abs(gradient)>${wgslF32(THIN_GEOMETRY_GRADIENT)}||abs(prevGradient)>${wgslF32(THIN_GEOMETRY_GRADIENT)})&&within;
   let flickered=select(1.0,0.0,gradient*prevGradient>0.0||(within&&!thinRegion)||view.params.x!=0.0);
   putPair(${held.index},min(abs(prevGradient),abs(gradient))*flickered,flickered);
   if(${tileWithin(plan, 0)}){
    let k=${blended.index};
    // The history, never below zero, carries the thin geometry region in its sign bit.
    tileWords[k]=bitcast<u32>(history)|select(0u,0x80000000u,thinRegion);tileWords[k+${blended.stride}u]=bitcast<u32>(gradient);
   }`,
  )

/** The stages that spread the swing and its count by their maxima, and write the flicker history and
 *  the error. */
const writeStages = ({ plan, pairs, held, blended, modified, nine, keep }: Context) =>
  [
    tileStage(
      plan,
      1,
      `  ${nine(held, held.index)}
   let most=max9p(near);
   putPair(${pairs.index},most.x,most.y);`,
    ),
    tileStage(
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
    ),
  ].join('\n')

/**
 * The text of the flicker network's stages over `plan`, in the order they run, each a tile stage
 * (`tileStage`) over the words of the workgroup memory (`flickerRegions`).
 */
export function flickerStages(plan: TilePlan) {
  const context = stageContext(plan)
  return [
    lumaStages(context),
    energyStages(context),
    replayStage(context),
    writeStages(context),
  ].join('\n')
}
