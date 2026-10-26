import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { fieldLayout, vec4Array } from '../gpu/core/fieldLayout.ts'
import {
  TEXTURE_FORMATS_TIER1_WGSL,
  hasTextureFormatsTier1,
} from '../gpu/core/textureFormatsTier.ts'
import { HERMITE_WGSL } from '../gpu/core/smoothstepEdges.ts'
import { EXPOSURE_MIDDLE_GREY } from '../../../sdk-core/src/contracts/exposureOptions.ts'
import { FILM } from './filmCurveConstants.ts'
import { FILMIC_WGSL, FILM_LAYOUT, FILM_STRUCT_WGSL } from './filmCurveWgsl.ts'
import { STANDARD_OUTPUT_13_WGSL } from './aces/aces13Wgsl.ts'
import { STANDARD_OUTPUT_WGSL } from './aces/acesWgsl.ts'
import { STORABLE_WGSL } from './storableWgsl.ts'
import { DISPLAY_VALUE_WGSL } from './toneMappingWgsl.ts'

/** The shaper's constants: a logarithm over 14 stops with middle grey at 444 of 1023 — a light of
 *  0.18 addresses the table at 444/1023 —, and the perceptual quantizer's (SMPTE ST 2084) five,
 *  over a range of 10000 nits of which a light of 1 is 100. */
const LOG = { range: 14, grey: EXPOSURE_MIDDLE_GREY, greyCode: 444 / 1023 } as const
const PQ = {
  m1: 0.1593017578125,
  m2: 78.84375,
  c1: 0.8359375,
  c2: 18.8515625,
  c3: 18.6875,
  peak: 10000,
  scale: 100,
} as const
/**
 * How a light addresses the baked table, and what a texel's code stands for, by the shaper
 * (`shaper` 0 the logarithm, 1 the perceptual quantizer): `shaperCode` is the code of a light, in
 * [0, 1], `shaperLight` the light of a code. The logarithm covers about 14 stops; its code of 0
 * stands for a small light, which the reader adds and the baking takes away, so that a light of 0
 * addresses the first texel and is 0 there; the quantizer reads 100 times the light, in nits, cut to
 * its range. The reader of the table (`toneLutRead.ts`) and its baking share the one text. A light
 * under 0 reads as 0: the logarithm of a negative has no value, which the reference's saturate
 * turned into 0, and `clamp` does not.
 */
export const TONE_SHAPER_WGSL = wgslBlock(
  'TONE_SHAPER_WGSL',
  [],
  `
fn logToLight(code:vec3f)->vec3f{return exp2((code-vec3f(${wgslF32(LOG.greyCode)}))*${wgslF32(LOG.range)})*${wgslF32(LOG.grey)};}
fn lightToLog(light:vec3f)->vec3f{
 return saturate(log2(max(light,vec3f(0.0)))/${wgslF32(LOG.range)}+${wgslF32(LOG.greyCode - Math.log2(LOG.grey) / LOG.range)});
}
fn quantizerLight(code:vec3f)->vec3f{
 let root=pow(code,vec3f(${wgslF32(1 / PQ.m2)}));
 let over=max(root-vec3f(${wgslF32(PQ.c1)}),vec3f(0.0));
 return pow(over/(vec3f(${wgslF32(PQ.c2)})-${wgslF32(PQ.c3)}*root),vec3f(${wgslF32(1 / PQ.m1)}))*${wgslF32(PQ.peak)};
}
fn quantizerCode(nits:vec3f)->vec3f{
 let power=pow(nits/${wgslF32(PQ.peak)},vec3f(${wgslF32(PQ.m1)}));
 return pow((vec3f(${wgslF32(PQ.c1)})+${wgslF32(PQ.c2)}*power)/(vec3f(1.0)+${wgslF32(PQ.c3)}*power),vec3f(${wgslF32(PQ.m2)}));
}
fn shaperCode(light:vec3f,shaper:f32)->vec3f{
 if(shaper!=0.0){return quantizerCode(clamp(light*${wgslF32(PQ.scale)},vec3f(0.0),vec3f(${wgslF32(PQ.peak)})));}
 return lightToLog(light+logToLight(vec3f(0.0)));
}
fn shaperLight(code:vec3f,shaper:f32)->vec3f{
 if(shaper!=0.0){return quantizerLight(code)/${wgslF32(PQ.scale)};}
 return logToLight(code)-logToLight(vec3f(0.0));
}`,
)

/** What a baked value is divided by when it is stored, and the table's reader multiplies it back
 *  by: 1.05 for the film curve, whose white clip of 0.04 lifts its output past 1 where a display
 *  value is cut — except under an explicit gamma (`explicitGamma`), where the reference's table
 *  ends at 1 —, 1 for every other curve, and for the standard output transform (`standardAces`),
 *  which end at 1. */
export const tableScale = (rank: number, explicitGamma: boolean, standardAces: boolean) =>
  rank === TONE_MAPPING_RANK.filmic && !explicitGamma && !standardAces ? 1.05 : 1

/** The colour grade's twenty vectors in the order `colorCorrectAll` reads them: the zone — all the
 *  light, the dark, the middle, the bright part — times five, plus the operation (saturation,
 *  contrast, gamma, gain, offset). */
const GRADE_VECTORS = 20

/**
 * The baking's uniform (`toneBakeParams.ts`), in order: `wb` the white balance's matrix, a column
 * of its `xyz` each; `film` the film curve (`Film`); `grade` the grade's vectors (`GRADE_VECTORS`);
 * `bounds` where the dark part ends, the bright part starts and is whole, and 1 where a white
 * balance applies; `mapping` the correction's polynomial `a x² + b x + c` and the power of the
 * display's gamma ratio; `device` the exponent of an explicit gamma, 1 where the colour is shown
 * by the power 2.4, 1 where the explicit gamma applies and the table's scale (`tableScale`);
 * `lattice` 1 over the texels a side less one, the texels a side, the rank of the scene's display
 * curve and the shaper; `aces` 1 where the film curve's place is the standard output transform's,
 * the scene's multiplier of its light, 1 where its version is the first (`STANDARD_OUTPUT_13_WGSL`)
 * and the share of that version's gamut compression.
 */
export const BAKE_LAYOUT = fieldLayout('Bake', [
  ['wb', 'array<vec4f,3>'],
  ['film', { wgsl: FILM_LAYOUT.name, words: FILM_LAYOUT.words, align: FILM_LAYOUT.align }],
  ['grade', vec4Array(GRADE_VECTORS)],
  ['bounds', 'vec4f'],
  ['mapping', 'vec4f'],
  ['device', 'vec4f'],
  ['lattice', 'vec4f'],
  ['aces', 'vec4f'],
] as const)
/** Bytes of the baking's uniform. */
export const BAKE_BYTES = BAKE_LAYOUT.words * 4
/** The declaration of the structure `Bake`: what the chain's functions and the views that carry
 *  a copy of the baking's words both name. */
export const BAKE_STRUCT_WGSL = wgslBlock('BAKE_STRUCT_WGSL', [FILM_STRUCT_WGSL], BAKE_LAYOUT.wgsl)

const { wgsl: M } = FILM

/**
 * The colour grade (`colorCorrect`, `colorCorrectAll`), in the film's working gamut: a saturation
 * about the luminance, a contrast about middle grey, a gamma, a gain and an offset, a zone's set of
 * them over the whole light's — products for the first four, a sum for the offset —, applied to the
 * light three times, as the dark, the middle and the bright part, which the luminance weighs: the
 * dark part by `1 − hermite(0, shadowsMax, luma)`, the bright one by `hermite(highlightsMin,
 * highlightsMax, luma)` — smooth steps for any order of the edges (`HERMITE_WGSL`) —, the middle
 * one what is left of both. At the defaults the three are the
 * light with its negative channels cut, and the weights sum to 1.
 */
const GRADE_WGSL = wgslBlock(
  'GRADE_WGSL',
  [HERMITE_WGSL],
  `
fn colorCorrect(c:vec3f,saturation:vec4f,contrast:vec4f,gamma:vec4f,gain:vec4f,offset:vec4f)->vec3f{
 let luma=dot(c,${M.luma});
 var w=max(mix(vec3f(luma),c,saturation.xyz*saturation.w),vec3f(0.0));
 w=pow(w*${wgslF32(1 / EXPOSURE_MIDDLE_GREY)},contrast.xyz*contrast.w)*${wgslF32(EXPOSURE_MIDDLE_GREY)};
 w=pow(w,vec3f(1.0)/(gamma.xyz*gamma.w));
 return w*(gain.xyz*gain.w)+(offset.xyz+offset.w);
}
fn gradeVector(b:Bake,zone:u32,operation:u32)->vec4f{return b.grade[zone*5u+operation];}
fn zoneCorrect(b:Bake,c:vec3f,zone:u32)->vec3f{
 return colorCorrect(c,gradeVector(b,zone,0u)*gradeVector(b,0u,0u),gradeVector(b,zone,1u)*gradeVector(b,0u,1u),gradeVector(b,zone,2u)*gradeVector(b,0u,2u),gradeVector(b,zone,3u)*gradeVector(b,0u,3u),gradeVector(b,zone,4u)+gradeVector(b,0u,4u));
}
fn colorCorrectAll(b:Bake,c:vec3f)->vec3f{
 let luma=dot(c,${M.luma});
 let shadows=1.0-hermite(0.0,b.bounds.x,luma);
 let highlights=hermite(b.bounds.y,b.bounds.z,luma);
 return zoneCorrect(b,c,1u)*shadows+zoneCorrect(b,c,2u)*(1.0-shadows-highlights)+zoneCorrect(b,c,3u)*highlights;
}`,
)

/**
 * The baking's chain: for the light `source`, the colour the display shows, divided by the table's
 * scale and cut to what the table stores (`displayLight`), and for the texel of the table whose
 * code is `encoded` the same of the light that code stands for (`tableColor`). In the reference's
 * order: the light, the white balance, the film curve's expansion of the gamut and the grade in its
 * working gamut, then the film curve — blue correction, glow and red modifier, the curve of each
 * channel, the blue correction undone —, the correction's polynomial and the power of the
 * display's gamma ratio, or, where the method is the standard output transform, that transform
 * (`acesDisplay`, or `aces13Display` in its first version) of the graded light, cut to the range the
 * quantizer reads; any other display curve takes the graded light back to sRGB
 * and applies itself (only the film curve's place expands the gamut, and only the film curve
 * corrects and has the gamma ratio); last, the
 * display's transfer — an explicit gamma, the power 1/2.4, or sRGB's curve — and the scale. Its
 * functions take the baking's words as a `Bake` (`BAKE_LAYOUT`): the baking's uniform, or the copy
 * of it that a layer drawn over the table carries (`displayRoute`), which then shows the colours the
 * table gives.
 */
export const TONE_CHAIN_WGSL = wgslBlock(
  'TONE_CHAIN_WGSL',
  [
    BAKE_STRUCT_WGSL,
    DISPLAY_VALUE_WGSL,
    FILMIC_WGSL,
    STANDARD_OUTPUT_WGSL,
    STANDARD_OUTPUT_13_WGSL,
    TONE_SHAPER_WGSL,
    GRADE_WGSL,
    STORABLE_WGSL,
  ],
  `
fn displayLight(b:Bake,source:vec3f)->vec3f{
 var light=source;
 if(b.bounds.w!=0.0){light=mat3x3f(b.wb[0].xyz,b.wb[1].xyz,b.wb[2].xyz)*light;}
 let rank=u32(b.lattice.z);
 var shown=vec3f(0.0);
 if(rank==${TONE_MAPPING_RANK.filmic}u){
  let graded=colorCorrectAll(b,expandedGamut(${M.srgbToWorking}*light,b.film));
  if(b.aces.x!=0.0){
   let light=clamp(graded,vec3f(0.0),vec3f(${wgslF32(PQ.peak / PQ.scale)}));
   if(b.aces.z!=0.0){shown=aces13Display(light,b.aces.y,b.aces.w);}
   else{shown=acesDisplay(light,b.aces.y);}
  }
  else{
   let film=filmicFromAp1(graded,b.film);
   let corrected=b.mapping.x*(film*film)+b.mapping.y*film+vec3f(b.mapping.z);
   shown=pow(max(corrected,vec3f(0.0)),vec3f(b.mapping.w));
  }
 }else{
  let graded=${M.workingToSrgb}*colorCorrectAll(b,${M.srgbToWorking}*light);
  shown=toneMap(max(graded,vec3f(0.0)),rank);
 }
 var value=linearToSrgb(shown);
 if(b.device.z!=0.0){value=pow(shown,vec3f(b.device.x));}
 else if(b.device.y!=0.0){value=pow(shown,vec3f(${wgslF32(1 / 2.4)}));}
 return storable(value/b.device.w);
}
fn tableColor(b:Bake,encoded:vec3f)->vec3f{return displayLight(b,shaperLight(encoded,b.lattice.w));}`,
)

/** The formats the table's texels are stored in, both holding a colour at ten bits a channel: the
 *  packed one where the device grants storage textures of it, the half float otherwise. */
export type ToneTableFormat = 'rgb10a2unorm' | 'rgba16float'

/** The table's format on `features`, a device's: ten bits a channel, in the packed format where
 *  the device stores to it (`texture-formats-tier1`), else in the half float with the cut to ten
 *  bits made by the baking. */
export const toneTableFormat = (features: { has(name: string): boolean }): ToneTableFormat =>
  hasTextureFormatsTier1(features) ? 'rgb10a2unorm' : 'rgba16float'

/**
 * The baking: `bakeTable` writes one texel of the table a thread, the colour of the chain
 * (`TONE_CHAIN_WGSL`) for the light its code stands for, as a table of `format` stores it. The
 * packed format (`rgb10a2unorm`, which needs the storage textures of `texture-formats-tier1`) cuts
 * each channel to ten bits as it is stored; in the half float the program makes that cut itself,
 * so that both hold the same values, the half float's own rounding (a quarter of a step at most)
 * apart.
 */
const toneBakeWgsl = (format: ToneTableFormat) => {
  const packed = format === 'rgb10a2unorm'
  const texel = 'tableColor(bake,vec3f(id)*bake.lattice.x)'
  const color = packed ? texel : `round(${texel}*1023.0)/1023.0`
  return wgslBlock(
    `toneBakeWgsl(${format})`,
    packed ? [TONE_CHAIN_WGSL, TEXTURE_FORMATS_TIER1_WGSL] : [TONE_CHAIN_WGSL],
    `
@group(0) @binding(0) var<uniform> bake:Bake;
@group(0) @binding(1) var table:texture_storage_3d<${format},write>;
@compute @workgroup_size(4,4,4)
fn bakeTable(@builtin(global_invocation_id) id:vec3u){
 let size=u32(bake.lattice.y);
 if(id.x>=size||id.y>=size||id.z>=size){return;}
 textureStore(table,id,vec4f(${color},0.0));
}`,
  )
}

/** The baking's module: the compute stage `bakeTable` over a 3D table of `format`. */
export const toneBakeShader = (format: ToneTableFormat) => wgslModule(toneBakeWgsl(format))

/** The workgroup's side, in texels: the dispatch covers the table in groups of 4 × 4 × 4. */
export const BAKE_GROUP = 4
