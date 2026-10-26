import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  tileRegion,
  tileStage,
  tileWithin,
  tileWords,
  type TilePlan,
  type TileRegion,
} from './tileWgsl.ts'

/** The thin geometry detection's tile and the border its chain of seven 3×3 operators reads. */
export const THIN_GEOMETRY_PLAN: TilePlan = { width: 16, height: 16, border: 7 }

/** Its bindings. */
export const THIN_GEOMETRY_BINDINGS = {
  view: 0,
  depth: 1,
  luma: 2,
  coverage: 3,
  marks: 4,
  word: 5,
  thinOut: 8,
} as const

/**
 * The thin geometry detection's output of each render texel, which its weight relaxation reads: in
 * red the coverage history — six bits of coverage over the translucency bit and the high contrast
 * line bit (`THIN_COVERAGE_BITS`) —, in green the mask — the history relaxation weight in seven
 * bits over the cluster hole bit (`THIN_MASK_BITS`). The relaxation writes both, trimmed by the
 * translucency, as bytes of the measures' layers (`MEASURE_LAYERS.mask`, `.history`,
 * `flickerLumaWgsl.ts`): the reprojection carries the last image's coverage history in its word
 * (`reprojectWgsl.ts`); the flicker measure and the shading rejection read the mask
 * (`rejectionWgsl.ts`).
 */
export const THIN_GEOMETRY_FORMAT: GPUTextureFormat = 'rgba8uint'

/** The coverage history's byte: the high contrast line, the translucency, then the coverage. */
export const THIN_COVERAGE_BITS = { line: 1, translucency: 2, shift: 2, most: 63 } as const
/** The mask's byte: the cluster hole region, then the relaxation weight in 127ths. */
export const THIN_MASK_BITS = { clusterHole: 1, shift: 1, most: 127 } as const

/** The scale a coverage is read as a material mask by (1 a plain surface, 2 the foliage). */
const MATERIAL_MASK_SCALE = 2.01

/** The share a coverage history takes the coverage at when the two agree. */
const COVERAGE_SAMPLE_WEIGHT = 0.1
/** The critical value of the agreement test over the nine texels: 2.306 (p = 0.05) nine times. */
const AGREEMENT_CRITICAL = 20.754

/** The regions of `tileWords` the detection's stages share, each named by what it holds. */
export interface ThinRegions {
  samples: TileRegion
  tests: TileRegion
  lines: TileRegion
  kept: TileRegion
  finals: TileRegion
  least: TileRegion
  weights: TileRegion
}

/** The regions, each named by what it holds: the tests' counts and agreement and the kept history
 *  and lines, in the test's second plane once the test is read; the samples, beside it; the lines'
 *  counts and the first greatest, and the first least and the capped weights, in the words the
 *  samples left dead; the weight, edge, line and bits of a texel within two of the written. */
export function thinRegions(): ThinRegions {
  const plan = THIN_GEOMETRY_PLAN
  const tests = tileRegion(plan, 6, 2)
  const samples = tileRegion(plan, 7, 2, tests.end)
  const lines = tileRegion(plan, 5, 2, tests.end)
  // The test's second plane, its spread and history read by the stage that writes this.
  const kept = tileRegion(plan, 6, 1, tests.end - tests.stride)
  const finals = tileRegion(plan, 2, 2, lines.end)
  const least = tileRegion(plan, 3, 1, tests.end)
  const weights = tileRegion(plan, 1, 1, least.end)
  if (weights.end > lines.end) throw new Error('TAA_THIN_GEOMETRY_REGIONS')
  return { samples, tests, lines, kept, finals, least, weights }
}

/** The WGSL word of the 3×3 neighbour `n` of the word `k`, in `region`. */
const near = (region: TileRegion, k: string) => `nearWord(${k},n,${region.side})`
const C = THIN_COVERAGE_BITS
const M = THIN_MASK_BITS

/** The detection's bindings, workgroup words and helpers, over `words` tile words. */
export const thinDeclarations = (words: number) =>
  `@group(0) @binding(${THIN_GEOMETRY_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.depth}) var depth:texture_depth_2d;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.luma}) var flickerLuma:texture_2d<f32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.coverage}) var materialCoverages:texture_2d<f32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${THIN_GEOMETRY_BINDINGS.thinOut}) var thinOut:texture_storage_2d<${THIN_GEOMETRY_FORMAT},write>;
${tileWords(words, 4)}
/** Bit 0: a span texel holds coverage off a pixel animation; bit 1: foliage does. */
var<workgroup> anyCoverage:atomic<u32>;
/** The material's coverage of texel \`q\`, measured before the translucency: a half for a lit
 *  surface, none of the background or of an unlit row. */
fn materialCoverage(q:vec2i)->f32{return textureLoad(materialCoverages,q,0).r;}
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
}`

/** The first stage: each span texel's depth, coverage, luma and coverage history. */
const thinSampleStage = ({ samples }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    7,
    `   let z=textureLoad(depth,c,0);
   let word=reprojectedWord(c);
   var cover=0.0;var foliage=false;var history=0.0;var luma=1.0;
   if(view.params.x==0.0){
    let mark=textureLoad(marks,c,0);
    if((mark.r&0x80u)!=0u){
     let o=vec2i(i32(mark.a&3u),i32((mark.a>>2u)&3u))-vec2i(1);
     let covered=max(materialCoverage(c),materialCoverage(clampTexel(c+o)));
     foliage=covered*${wgslF32(MATERIAL_MASK_SCALE)}>=2.0;
     cover=select(floor(covered),ceil(covered),view.thinFade.w!=0.0);
    }
    history=f32(coverageByte(word)>>${C.shift}u)/${C.most}.0;
    luma=textureLoad(flickerLuma,c,0).r;
   }
   if(!isAnimated(word)){atomicOr(&anyCoverage,select(0u,1u,cover>0.0)|select(0u,2u,foliage));}
   let k=${samples.index};
   tileWords[k]=(bitcast<u32>(z)&0x3fffffffu)|select(0u,0x80000000u,cover>0.0)|select(0u,0x40000000u,foliage);
   putPair(k+${samples.stride}u,luma,history);`,
  )

/** The second stage: the lines' four counts and the coverage test. */
const thinTestStage = ({ samples, tests }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    6,
    `   let k=${samples.index};
   var z:array<f32,9>;var luma:array<f32,9>;var sums=vec3f(0.0);
   for(var n=0;n<9;n++){
    let s=${near(samples, 'k')};let w=tileWords[s];let p=pairAt(s+${samples.stride}u);
    z[n]=bitcast<f32>(w&0x3fffffffu);luma[n]=p.x;
    sums+=vec3f(p.y,f32(w>>31u),p.y*(1.0-p.y));
   }
   let zError=pixelDeviceZError(z[4])*view.thin.x;
   let counts=(u32(z[4]-z[1]>zError)+u32(z[4]-z[7]>zError))
    |((u32(z[4]-z[3]>zError)+u32(z[4]-z[5]>zError))<<2u)
    |((u32(luma[4]-luma[1]>view.thin.y)+u32(luma[4]-luma[7]>view.thin.y))<<4u)
    |((u32(luma[4]-luma[3]>view.thin.y)+u32(luma[4]-luma[5]>view.thin.y))<<6u);
   // The coverage history less the coverage against the history's spread at its sample weight.
   let excess=sums.x-sums.y;
   let spread=sqrt(sums.z+0.000001)*${wgslF32(Math.sqrt((COVERAGE_SAMPLE_WEIGHT / (2 - COVERAGE_SAMPLE_WEIGHT)) * 72))};
   let t=abs(select(0.0,excess/spread,excess>0.0));
   let w=tileWords[k];
   let kt=${tests.index};
   tileWords[kt]=counts|((w>>31u)<<8u)|(((w>>30u)&1u)<<10u);
   putPair(kt+${tests.stride}u,t,pairAt(k+${samples.stride}u).y);`,
  )

/** The third stage: the first greatest of the test and the coverage, and the lines. */
const thinLinesStage = ({ tests, lines }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    5,
    `   let kt=${tests.index};
   var counts:array<u32,9>;var most=vec2f(0.0);
   for(var n=0;n<9;n++){
    let s=${near(tests, 'kt')};counts[n]=tileWords[s];
    most=max(most,vec2f(pairAt(s+${tests.stride}u).x,f32((counts[n]>>8u)&1u)));
   }
   let kl=${lines.index};
   putPair(kl,most.x,most.y);
   putPair(kl+${lines.stride}u,thinLine(counts,0u),saturate(ceil(thinLine(counts,4u))));`,
  )

/** The fourth stage: the agreement beside the test's counts, the coverage history and the lines
 *  kept, and the weight, edge, line and bits of a texel within two of the written. */
const thinFinalsStage = ({ tests, lines, kept, finals }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    4,
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
   let fade=select(view.thinFade.x,view.thinFade.y,clusterHole);
   let decay=(1.0-line.y)*select(0.0,1.0,fade>imageNoise(c));
   let lastLine=f32(coverageByte(word)&${C.line}u);
   let lineKept=max(line.y,select(lastLine,0.0,view.params.x!=0.0))*(1.0-decay);
   var relaxation=abs(history-0.5)+0.02;
   relaxation=relaxation*exp(relaxation*-20.0)*${wgslF32(10 / 0.184)};
   tileWords[kt]=tileWords[kt]|(u32(agree)<<9u);
   putPair(${kept.index},history,1.0-lineKept);
   if(${tileWithin(THIN_GEOMETRY_PLAN, 2)}){
    let kf=${finals.index};
    putPair(kf,relaxation,line.x);
    putPair(kf+${finals.stride}u,lineKept,f32(u32(region)|(u32(line.y>0.0)<<1u)));
   }`,
  )

/** The fifth stage: the first least of the kept history and lines. */
const thinKeptStage = ({ kept, least }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    3,
    `   let kk=${kept.index};
   var low=vec2f(1.0);
   for(var n=0;n<9;n++){low=min(low,pairAt(${near(kept, 'kk')}));}
   putPair(${least.index},low.x,low.y);`,
  )

/** The sixth stage: the relaxation weight of a texel held to the 5×5 least history, the region and
 *  the agreement, uncapped, over the weight it had. */
const thinWeightStage = ({ tests, least, finals }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    2,
    `   let kq=${least.index};
   var low=1.0;
   for(var n=0;n<9;n++){low=min(low,pairAt(${near(least, 'kq')}).x);}
   let kf=${finals.index};
   let first=pairAt(kf);
   let region=(u32(pairAt(kf+${finals.stride}u).y)&1u)!=0u;
   let agree=((tileWords[${tests.index}]>>9u)&1u)!=0u;
   putPair(kf,select(0.0,first.x,low>0.0&&region&&agree),first.y);`,
  )

/** Whether the dilation runs, a condition the whole workgroup shares: where the range does not vary,
 *  always; else where foliage lies in the span off a pixel animation, the other surfaces taking their
 *  own weight and edge. */
const THIN_DILATES = '(atomicLoad(&anyCoverage)&2u)!=0u||view.thinFade.w==0.0'

/** The seventh stage: the weight spread by the 3×3 sum (0.8, 1, 0.8)², at most the setting's
 *  (`view.thinFade.z`, 0.037), saturated. */
const thinSpreadStage = ({ finals, weights }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    1,
    `   let kf=${finals.index};
   var held:array<f32,9>;
   for(var n=0;n<9;n++){held[n]=pairAt(${near(finals, 'kf')}).x;}
   tileWords[${weights.index}]=bitcast<u32>(saturate(sum9(held,vec3f(0.8,1.0,0.8))*view.thinFade.z));`,
    false,
    THIN_DILATES,
  )

/** The last stage: the written texels' mask and coverage history. */
const thinLeastStage = ({ tests, kept, least, finals, weights }: ThinRegions) =>
  tileStage(
    THIN_GEOMETRY_PLAN,
    0,
    `   let kq=${least.index};
   var lineLow=1.0;
   for(var n=0;n<9;n++){lineLow=min(lineLow,pairAt(${near(least, 'kq')}).y);}
   let kf=${finals.index};
   let second=pairAt(kf+${finals.stride}u);
   let bits=u32(second.y);
   let onLine=f32((bits>>1u)&1u);
   var edges:array<f32,9>;
   for(var n=0;n<9;n++){edges[n]=pairAt(${near(finals, 'kf')}).y;}
   let kw=${weights.index};
   var held:array<f32,9>;
   for(var n=0;n<9;n++){held[n]=bitcast<f32>(tileWords[${near(weights, 'kw')}]);}
   let kt=${tests.index};
   let agree=((tileWords[kt]>>9u)&1u)!=0u;
   let cover=f32((tileWords[kt]>>8u)&1u);
   let word=reprojectedWord(c);
   let animated=isAnimated(word);
   let hadTranslucency=select(0.0,1.0,(coverageByte(word)&${C.translucency}u)!=0u&&view.params.x==0.0);
   var history=pairAt(${kept.index}).x;
   let seen=atomicLoad(&anyCoverage);
   let plain=view.thinFade.w!=0.0&&((seen&2u)==0u||(((tileWords[kt]>>8u)&1u)!=0u&&((tileWords[kt]>>10u)&1u)==0u));
   let own=pairAt(kf);
   var edge=select(sum9(edges,vec3f(0.8,1.0,0.8)),own.y,plain);var lineKept=second.x;
   var relaxation=select(saturate(sum9(held,vec3f(0.5,1.0,0.5))),own.x,plain);
   let lineWeight=(1.0-lineLow)*(1.0-onLine);
   relaxation=select(lineWeight*view.thin.z,relaxation,relaxation>0.0);
   let untranslucent=1.0-hadTranslucency;
   relaxation*=untranslucent;edge*=untranslucent;lineKept*=untranslucent;
   relaxation=select(0.0,relaxation,agree&&!animated);
   edge=select(edge,0.0,animated);
   var clusterHole=history>${wgslF32(0.99 / 127)};
   if((seen&1u)==0u){history=cover;edge=0.0;relaxation=0.0;clusterHole=false;lineKept=0.0;}
   var weight=select(0.0,relaxation,clusterHole);
   weight=select(weight,edge,edge>0.0);
   clusterHole=clusterHole&&!(edge>0.0);
   let mask=(min(u32(weight*${M.most}.0),${M.most}u)<<${M.shift}u)|select(0u,${M.clusterHole}u,clusterHole);
   let coverage=(u32(clamp(saturate(history)*${C.most}.0+imageNoise(g),0.0,${C.most}.0))<<${C.shift}u)|select(0u,${C.line}u,lineKept>0.0);
   if(all(g<vec2i(view.render.xy))){textureStore(thinOut,g,vec4u(coverage,mask,0u,0u));}`,
    true,
  )

/** The detection's eight stages, in the order they run, joined as the kernel's body. */
export const thinStages = (r: ThinRegions) =>
  [
    thinSampleStage(r),
    thinTestStage(r),
    thinLinesStage(r),
    thinFinalsStage(r),
    thinKeptStage(r),
    thinWeightStage(r),
    thinSpreadStage(r),
    thinLeastStage(r),
  ].join('\n')
