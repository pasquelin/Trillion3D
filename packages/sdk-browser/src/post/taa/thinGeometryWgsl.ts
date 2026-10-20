import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../visibility/shader/pageWgsl.ts'
import { FLAG_LIT } from '../../visibility/types.ts'
import { visPageIndex } from '../../visibility/visWords.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { FLICKER_LUMA_WGSL } from './colorSpaceWgsl.ts'
import { DEPTH_WGSL } from './depthWgsl.ts'
import { REPROJECTED_WORD_WGSL } from './reprojectWgsl.ts'
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

/** The thin geometry detection's tile and the border its chain of five 3×3 operators reads. */
export const THIN_GEOMETRY_PLAN: TilePlan = { width: 16, height: 16, border: 5 }

/** Its bindings. */
export const THIN_GEOMETRY_BINDINGS = {
  view: 0,
  depth: 1,
  ids: 2,
  pages: 3,
  marks: 4,
  word: 5,
  current: 6,
  reactive: 7,
  thinOut: 8,
} as const

/**
 * The thin geometry of each render texel, a render-resolution history beside this image's mask: in
 * red the coverage history — six bits of coverage over the translucency bit and the high contrast
 * line bit (`THIN_COVERAGE_BITS`) —, in green the mask — the history relaxation weight in seven
 * bits over the cluster hole bit (`THIN_MASK_BITS`). The reprojection carries the last image's
 * coverage in its word (`reprojectWgsl.ts`); the flicker measure and the shading rejection read the
 * mask (`flickerWgsl.ts`, `rejectionWgsl.ts`).
 */
export const THIN_GEOMETRY_FORMAT: GPUTextureFormat = 'rgba8uint'

/** The coverage history's byte: the high contrast line, the translucency, then the coverage. */
export const THIN_COVERAGE_BITS = { line: 1, translucency: 2, shift: 2, most: 63 } as const
/** The mask's byte: the cluster hole region, then the relaxation weight in 127ths. */
export const THIN_MASK_BITS = { clusterHole: 1, shift: 1, most: 127 } as const

/** The depth step past which a texel stands out as a thin line: ten pixel depth errors — the edge
 *  error multiplier, 200, at its twentieth, as a range of materials takes it. */
const THIN_DEPTH_ERRORS = Math.max(200 * 0.05, 1)
/** The luma contrast past which a texel stands out as a thin line of light. */
const THIN_LINE_CONTRAST = 0.3
/** The share a coverage history takes the coverage at when the two agree. */
const COVERAGE_SAMPLE_WEIGHT = 0.1
/** The critical value of the agreement test over the nine texels: 2.306 (p = 0.05) nine times. */
const AGREEMENT_CRITICAL = 20.754
/** How often a high contrast line not seen again fades, outside and inside a cluster hole
 *  region. */
const LINE_FADE_RATE = 0.1
const LINE_FADE_RATE_INSIDE = 0.03
/** The relaxation weight of a high contrast line where no cluster relaxes the history. */
const LINE_WEIGHT = 0.6
/** The translucency share past which a texel's thin geometry is rejected, and its history's. */
const TRANSLUCENCY_REJECTION = 0.6

/**
 * The thin geometry detection, per render texel, after the reprojection (`reprojectWgsl.ts`): where
 * geometry thinner than a pixel flickers under the jitter, how far the shading rejection may relax
 * its history clamp and count its flicker over a longer period.
 * - The coverage: on a texel that took a neighbour's velocity (the marks' offset bit), whether the
 *   texel or that neighbour holds a lit surface — none of the background or an unlit one —, one or
 *   zero. The coverage history the reprojection read, its high contrast line and translucency bits;
 *   the flicker luma (`flickerLumaStep`); on a cut none of either, a white luma.
 * - Thin lines: a texel nearer than both its vertical neighbours by ten pixel depth errors, its
 *   horizontal neighbours so too, a line three texels long, and the same across; of light, the
 *   flicker luma brighter by 0.3 — a high contrast line.
 * - The agreement of the coverage history with the coverage, a Student t test over the 3×3 of a
 *   Bernoulli law; the 5×5 greatest of the test and of the coverage: the history kept at a share
 *   of 0.1 where the region holds coverage, the two agree, they differ somewhere and no pixel
 *   animation lies there, taken whole else. A cluster hole region where that history is above
 *   0.99 of a step.
 * - High contrast lines kept through the dark images, faded at random (interleaved gradient noise)
 *   at 0.1 an image, 0.03 inside a cluster hole region.
 * - The relaxation weight, `x·e^(−20x)·10/0.184` of `x = |history − ½| + 0.02`, none unless the
 *   5×5 least of the history, the region and the agreement hold it; where none, 0.6 near a high
 *   contrast line seen in the 5×5 and not on it; none past the last image's translucency, the
 *   agreement or a pixel animation, no thin line on one.
 * - The mask: the weight of a cluster hole region, else of a thin line, which clears the region
 *   bit; the coverage history in six bits, dithered, with the high contrast line bit.
 * - The weight trimmed by the transparents' share of the colour (the reactive value): toward none
 *   as that share passes 0.05 to 0.6, on a cluster hole region or past 0.6; past 0.6 the coverage
 *   history keeps the translucency bit alone, so the next image relaxes nothing there.
 * A workgroup whose span holds no coverage off a pixel animation takes the coverage whole and
 * relaxes nothing.
 *
 * The network runs over 16×16 tiles: the depth and the coverage bit in one word, the luma and the
 * coverage history in a half-float pair; the lines' four counts and the coverage in one word.
 * Loads per span texel: the depth, the marks, the reprojection word, the colour and one or two
 * identifiers with their page; the written texels the reprojection word and the reactive value.
 */
export const thinGeometryShader = () => {
  const plan = THIN_GEOMETRY_PLAN
  // The regions, each named by what it holds: the samples, then the lines' counts and the test;
  // the lines and the first greatest; the history and the lines kept; a written texel's weight,
  // line and bits; the first least.
  const samples = tileRegion(plan, 5, 2)
  const tests = tileRegion(plan, 4, 2, samples.end)
  const lines = tileRegion(plan, 3, 2)
  const kept = tileRegion(plan, 2, 1, tests.end)
  const finals = tileRegion(plan, 0, 2, kept.end)
  const least = tileRegion(plan, 1, 1)
  if (lines.end > samples.end || least.end > samples.end)
    throw new Error('TAA_THIN_GEOMETRY_REGIONS')
  const near = (region: typeof samples, k: string) => `nearWord(${k},n,${region.side})`
  const C = THIN_COVERAGE_BITS
  const M = THIN_MASK_BITS
  return wgslProgram(
    `@group(0) @binding(${THIN_GEOMETRY_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.ids}) var ids:texture_2d<u32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.pages}) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.reactive}) var reactive:texture_2d<f32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.thinOut}) var thinOut:texture_storage_2d<${THIN_GEOMETRY_FORMAT},write>;
${tileWords(finals.end, 4)}
var<workgroup> anyCoverage:atomic<u32>;
/** Whether texel \`q\` holds a lit surface: a half for the material, none of the background or of
 *  an unlit row. */
fn materialCoverage(q:vec2i)->f32{
 let id=textureLoad(ids,q,0).r;
 if(id==0u){return 0.0;}
 return select(0.0,0.5,(pages[visPageIndex(id)].flags&${FLAG_LIT}u)!=0u);
}
/** The coverage history byte the reprojection carried (bits 16 to 23 of its word). */
fn coverageByte(word:u32)->u32{return (word>>16u)&0xffu;}
/** The image's interleaved gradient noise at texel \`p\`, of its accumulated rank. */
fn imageNoise(p:vec2i)->f32{return interleavedGradientNoise(vec2f(p),view.jitter.z);}
/** The horizontal and vertical thin line of the counts \`p\` (two bits each, at \`shift\`): the
 *  centre standing out of both neighbours across, and at least one more texel along. */
fn thinLine(p:array<u32,9>,shift:u32)->f32{
 var t=p;
 let h=f32(((t[3]>>shift)&3u)+((t[5]>>shift)&3u))*saturate(f32((t[4]>>shift)&3u)-1.0);
 let v=f32(((t[1]>>(shift+2u))&3u)+((t[7]>>(shift+2u))&3u))*saturate(f32((t[4]>>(shift+2u))&3u)-1.0);
 return saturate((h-2.0)*0.5)+saturate((v-2.0)*0.5);
}
${tileEntry(plan, 'detectThinGeometry')}
${tileStage(
  plan,
  5,
  `   let z=textureLoad(depth,c,0);
   let word=reprojectedWord(c);
   var cover=0.0;var history=0.0;var luma=1.0;
   if(view.params.x==0.0){
    let mark=textureLoad(marks,c,0);
    if((mark.r&0x80u)!=0u){
     let o=vec2i(i32(mark.a&3u),i32((mark.a>>2u)&3u))-vec2i(1);
     cover=ceil(max(materialCoverage(c),materialCoverage(clampTexel(c+o))));
    }
    history=f32(coverageByte(word)>>${C.shift}u)/${C.most}.0;
    luma=flickerLumaStep(textureLoad(current,c,0).rgb*view.exposure.x)/255.0;
   }
   if(cover>0.0&&!isAnimated(word)){atomicOr(&anyCoverage,1u);}
   let k=${samples.index};
   tileWords[k]=(bitcast<u32>(z)&0x7fffffffu)|select(0u,0x80000000u,cover>0.0);
   putPair(k+${samples.stride}u,luma,history);`,
)}
${tileStage(
  plan,
  4,
  `   let k=${samples.index};
   var z:array<f32,9>;var luma:array<f32,9>;var sums=vec3f(0.0);
   for(var n=0;n<9;n++){
    let s=${near(samples, 'k')};let w=tileWords[s];let p=pairAt(s+${samples.stride}u);
    z[n]=bitcast<f32>(w&0x7fffffffu);luma[n]=p.x;
    sums+=vec3f(p.y,f32(w>>31u),p.y*(1.0-p.y));
   }
   let zError=pixelDeviceZError(z[4])*${wgslF32(THIN_DEPTH_ERRORS)};
   let counts=(u32(z[4]-z[1]>zError)+u32(z[4]-z[7]>zError))
    |((u32(z[4]-z[3]>zError)+u32(z[4]-z[5]>zError))<<2u)
    |((u32(luma[4]-luma[1]>${wgslF32(THIN_LINE_CONTRAST)})+u32(luma[4]-luma[7]>${wgslF32(THIN_LINE_CONTRAST)}))<<4u)
    |((u32(luma[4]-luma[3]>${wgslF32(THIN_LINE_CONTRAST)})+u32(luma[4]-luma[5]>${wgslF32(THIN_LINE_CONTRAST)}))<<6u);
   // The coverage history less the coverage against the history's spread at its sample weight.
   let excess=sums.x-sums.y;
   let spread=sqrt(sums.z+0.000001)*${wgslF32(Math.sqrt((COVERAGE_SAMPLE_WEIGHT / (2 - COVERAGE_SAMPLE_WEIGHT)) * 72))};
   let t=abs(select(0.0,excess/spread,excess>0.0));
   let w=tileWords[k];
   let kt=${tests.index};
   tileWords[kt]=counts|((w>>31u)<<8u);
   putPair(kt+${tests.stride}u,t,pairAt(k+${samples.stride}u).y);`,
)}
${tileStage(
  plan,
  3,
  `   let kt=${tests.index};
   var counts:array<u32,9>;var most=vec2f(0.0);
   for(var n=0;n<9;n++){
    let s=${near(tests, 'kt')};counts[n]=tileWords[s];
    most=max(most,vec2f(pairAt(s+${tests.stride}u).x,f32((counts[n]>>8u)&1u)));
   }
   let kl=${lines.index};
   putPair(kl,most.x,most.y);
   putPair(kl+${lines.stride}u,thinLine(counts,0u),saturate(ceil(thinLine(counts,4u))));`,
)}
${tileStage(
  plan,
  2,
  `   let kl=${lines.index};
   var most=vec2f(0.0);
   for(var n=0;n<9;n++){most=max(most,pairAt(${near(lines, 'kl')}));}
   let kt=${tests.index};
   let test=pairAt(kt+${tests.stride}u);
   let cover=f32((tileWords[kt]>>8u)&1u);
   let agree=test.x<${wgslF32(AGREEMENT_CRITICAL)};
   let region=most.y>0.0;
   let word=reprojectedWord(c);
   let animated=isAnimated(word);
   let weight=select(1.0,${wgslF32(COVERAGE_SAMPLE_WEIGHT)},region&&agree&&most.x>0.0&&!animated);
   let history=mix(test.y,cover,weight);
   let clusterHole=history>${wgslF32(0.99 / 127)};
   let line=pairAt(kl+${lines.stride}u);
   let fade=select(${wgslF32(LINE_FADE_RATE)},${wgslF32(LINE_FADE_RATE_INSIDE)},clusterHole);
   let decay=(1.0-line.y)*select(0.0,1.0,fade>imageNoise(c));
   let lastLine=f32(coverageByte(word)&${C.line}u);
   let lineKept=max(line.y,select(lastLine,0.0,view.params.x!=0.0))*(1.0-decay);
   var relaxation=abs(history-0.5)+0.02;
   relaxation=relaxation*exp(relaxation*-20.0)*${wgslF32(10 / 0.184)};
   putPair(${kept.index},history,1.0-lineKept);
   if(${tileWithin(plan, 0)}){
    let kf=${finals.index};
    putPair(kf,relaxation,line.x);
    putPair(kf+${finals.stride}u,lineKept,f32(u32(region)|(u32(line.y>0.0)<<1u)));
   }`,
)}
${tileStage(
  plan,
  1,
  `   let kk=${kept.index};
   var low=vec2f(1.0);
   for(var n=0;n<9;n++){low=min(low,pairAt(${near(kept, 'kk')}));}
   putPair(${least.index},low.x,low.y);`,
)}
${tileStage(
  plan,
  0,
  `   let kq=${least.index};
   var low=vec2f(1.0);
   for(var n=0;n<9;n++){low=min(low,pairAt(${near(least, 'kq')}));}
   let kf=${finals.index};
   let first=pairAt(kf);let second=pairAt(kf+${finals.stride}u);
   let bits=u32(second.y);
   let region=(bits&1u)!=0u;let onLine=f32((bits>>1u)&1u);
   let kt=${tests.index};
   let agree=pairAt(kt+${tests.stride}u).x<${wgslF32(AGREEMENT_CRITICAL)};
   let cover=f32((tileWords[kt]>>8u)&1u);
   let word=reprojectedWord(c);
   let animated=isAnimated(word);
   let hadTranslucency=select(0.0,1.0,(coverageByte(word)&${C.translucency}u)!=0u&&view.params.x==0.0);
   var history=pairAt(${kept.index}).x;
   var edge=first.y;var lineKept=second.x;
   var relaxation=select(0.0,first.x,low.x>0.0&&region&&agree);
   let lineWeight=(1.0-low.y)*(1.0-onLine);
   relaxation=select(lineWeight*${wgslF32(LINE_WEIGHT)},relaxation,relaxation>0.0);
   let untranslucent=1.0-hadTranslucency;
   relaxation*=untranslucent;edge*=untranslucent;lineKept*=untranslucent;
   relaxation=select(0.0,relaxation,agree&&!animated);
   edge=select(edge,0.0,animated);
   var clusterHole=history>${wgslF32(0.99 / 127)};
   if(atomicLoad(&anyCoverage)==0u){history=cover;edge=0.0;relaxation=0.0;clusterHole=false;lineKept=0.0;}
   var weight=select(0.0,relaxation,clusterHole);
   weight=select(weight,edge,edge>0.0);
   clusterHole=clusterHole&&!(edge>0.0);
   var mask=(min(u32(weight*${M.most}.0),${M.most}u)<<${M.shift}u)|select(0u,${M.clusterHole}u,clusterHole);
   var coverage=(u32(clamp(saturate(history)*${C.most}.0+imageNoise(g),0.0,${C.most}.0))<<${C.shift}u)|select(0u,${C.line}u,lineKept>0.0);
   // The transparents' share of the colour trims the weight, and past its threshold rejects the
   // coverage history for the next image.
   let share=textureLoad(reactive,min(c,vec2i(textureDimensions(reactive))-vec2i(1)),0).g;
   var trim=max(${wgslF32(TRANSLUCENCY_REJECTION)}-share,0.0);
   trim=min(trim*trim*3.33,1.0);
   trim=select(1.0,trim,(mask&${M.clusterHole}u)!=0u||share>${wgslF32(TRANSLUCENCY_REJECTION)});
   let maskWeight=f32(mask>>${M.shift}u)/${M.most}.0;
   if(maskWeight>0.0&&trim<1.0){mask=(u32(maskWeight*trim*${M.most}.0)<<${M.shift}u)|(mask&${M.clusterHole}u);}
   if(share>${wgslF32(TRANSLUCENCY_REJECTION)}){coverage=${C.translucency}u;}
   if(all(g<vec2i(view.render.xy))){textureStore(thinOut,g,vec4u(coverage,mask,0u,0u));}`,
  true,
)}
}`,
    [
      PAGE_INFO_STRUCT_WGSL,
      TAA_VIEW_WGSL,
      DEPTH_WGSL,
      FLICKER_LUMA_WGSL,
      REPROJECTED_WORD_WGSL,
      NINE_OPERATORS_WGSL,
      TILE_WORDS_WGSL,
      TILE_CLAMP_WGSL,
      interleavedGradientNoise,
      visPageIndex,
    ],
  )
}
