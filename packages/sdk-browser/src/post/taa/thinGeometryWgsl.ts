import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { TAA_VIEW_WGSL, packedStorageWgsl } from './bindingsWgsl.ts'
import { DEPTH_WGSL } from './depthWgsl.ts'
import { REPROJECTED_WORD_WGSL } from './reprojectWgsl.ts'
import { TRANSLUCENCY_WGSL } from './translucencyWgsl.ts'
import { NINE_OPERATORS_WGSL, TILE_CLAMP_WGSL, TILE_WORDS_WGSL, tileEntry } from './tileWgsl.ts'
import {
  THIN_COVERAGE_BITS,
  THIN_GEOMETRY_PLAN,
  THIN_MASK_BITS,
  thinDeclarations,
  thinRegions,
  thinStages,
} from './thinGeometryRegionsWgsl.ts'

export {
  THIN_COVERAGE_BITS,
  THIN_GEOMETRY_BINDINGS,
  THIN_GEOMETRY_FORMAT,
  THIN_GEOMETRY_PLAN,
  THIN_MASK_BITS,
} from './thinGeometryRegionsWgsl.ts'

/** Whether the thin geometry detection runs this image, as a WGSL condition the whole workgroup
 *  shares (`TAA_VIEW`'s `quality.w`, `writeTaaView`): where it does not, the mask and the coverage
 *  history are left as they were and every pass that reads the mask reads none. */
export const THIN_RUNS = 'view.quality.w!=0.0'

/** The weight relaxation's bindings. */
export const THIN_RELAXATION_BINDINGS = {
  view: 0,
  thin: 1,
  current: 2,
  translucency: 3,
  maskOut: 4,
  historyOut: 5,
} as const
/** The texels a workgroup of the weight relaxation covers across and down, a texel a lane. */
export const THIN_RELAXATION_TILE = 8

/** The translucency's share of the luma at which the relaxation weight is gone: it starts to fall
 *  at 0.05 and falls fast to this. */
const TRANSLUCENCY_ZERO_RATIO = 0.6

/**
 * The thin geometry detection, per render texel, after the reprojection (`reprojectWgsl.ts`): where
 * geometry thinner than a pixel flickers under the jitter, how far the shading rejection may relax
 * its history clamp and count its flicker over a longer period.
 * - The coverage: on a texel that took a neighbour's velocity (the marks' offset bit), whether the
 *   texel or that neighbour holds a lit surface — the material's coverage measured before the
 *   translucency (`measureThinCoverageShader`) —, one or zero; a texel takes the coverage's value as
 *   its material, 1 a plain lit surface, 2 the foliage (a coverage of one). Where the range varies
 *   (`thinFade.w`, `varyingRange`) any lit surface covers, else only the foliage. The coverage history the reprojection
 *   read, its high contrast line and translucency bits; the flicker luma measured before the
 *   translucency (`measureFlickerLumaShader`); on a cut none of either, a white luma.
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
 *   5×5 least of the history, the region and the agreement hold it, spread with the thin line
 *   edge by the 3×3 sum (0.8, 1, 0.8)², then at most the setting's cap (`view.thinFade.z`, 0.037)
 *   and spread by the 3×3 sum (½, 1, ½)², saturated; where none, 0.6 near a high contrast line seen
 *   in the 5×5 and not on it; none past the last image's translucency, the agreement or a pixel
 *   animation, no thin line on one. Where the range varies, the spread (the 3×3 sums and the cap)
 *   runs only if foliage lies in the span off a pixel animation, and a plain surface's texel keeps its
 *   weight and thin line edge as they were before it.
 * - The mask: the weight of a cluster hole region, else of a thin line, which clears the region
 *   bit; the coverage history in six bits, dithered, with the high contrast line bit. The
 *   translucency trims them in the weight relaxation that follows (`thinRelaxationShader`).
 * A workgroup whose span holds no coverage off a pixel animation takes the coverage whole and
 * relaxes nothing. The thresholds above are the settings' (`view.thin`, `view.thinFade`,
 * `temporalThinGeometryErrorMultiplier` and its neighbours), here at their defaults.
 *
 * The network runs over 16×16 tiles: the depth and the coverage bit in one word, the luma and the
 * coverage history in a half-float pair; the lines' four counts and the coverage in one word.
 * Loads per span texel: the depth, the marks, the reprojection word, the flicker luma and one or two
 * material coverages; the written texels the reprojection word.
 */
export const thinGeometryShader = () => {
  const regions = thinRegions()
  return wgslProgram(
    `${thinDeclarations(regions.finals.end)}
${tileEntry(THIN_GEOMETRY_PLAN, 'detectThinGeometry')}
${thinStages(regions)}
}`,
    [
      TAA_VIEW_WGSL,
      DEPTH_WGSL,
      REPROJECTED_WORD_WGSL,
      NINE_OPERATORS_WGSL,
      TILE_WORDS_WGSL,
      TILE_CLAMP_WGSL,
      interleavedGradientNoise,
    ],
  )
}

/**
 * THE THIN GEOMETRY'S WEIGHT RELAXATION, after the detection, a texel a lane: the detection's
 * weight trimmed by the translucency's share of the colour's luma (`translucencyRatio`, read from the
 * translucency target the image was composed with) — toward none as that share passes 0.05 to 0.6,
 * on a cluster hole region or past 0.6 —, and past the setting's threshold (`view.thin.w`, 0.6; none
 * where it is 0) the coverage history keeps the translucency bit alone, so the next image relaxes
 * nothing there. Written as bytes of the measures' layers: the mask, which the flicker measure and
 * the shading rejection read, and the coverage history, which the next image's reprojection
 * carries. Loads a texel: the detection's word, the colour and the translucency.
 */
export const thinRelaxationShader = (format: GPUTextureFormat) => {
  const C = THIN_COVERAGE_BITS
  const M = THIN_MASK_BITS
  const B = THIN_RELAXATION_BINDINGS
  return wgslProgram(
    `@group(0) @binding(${B.view}) var<uniform> view:TaaView;
@group(0) @binding(${B.thin}) var thin:texture_2d<u32>;
@group(0) @binding(${B.current}) var current:texture_2d<f32>;
@group(0) @binding(${B.translucency}) var translucency:texture_2d<f32>;
@group(0) @binding(${B.maskOut}) var maskOut:texture_storage_2d<${format},write>;
@group(0) @binding(${B.historyOut}) var historyOut:texture_storage_2d<${format},write>;
@compute @workgroup_size(${THIN_RELAXATION_TILE},${THIN_RELAXATION_TILE})
fn relaxThinGeometryWeight(@builtin(global_invocation_id) id:vec3u){
 let p=vec2i(id.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 let detected=textureLoad(thin,p,0);
 var coverage=detected.r;var mask=detected.g;
 let ratio=translucencyRatio(textureLoad(current,p,0).rgb,layersAt(p));
 var trim=max(${wgslF32(TRANSLUCENCY_ZERO_RATIO)}-ratio,0.0);
 trim=min(trim*trim*3.33,1.0);
 trim=select(1.0,trim,(mask&${M.clusterHole}u)!=0u||ratio>${wgslF32(TRANSLUCENCY_ZERO_RATIO)});
 let maskWeight=f32(mask>>${M.shift}u)/${M.most}.0;
 if(maskWeight>0.0&&trim<1.0){mask=(u32(maskWeight*trim*${M.most}.0)<<${M.shift}u)|(mask&${M.clusterHole}u);}
 if(view.thin.w>0.0&&ratio>view.thin.w){coverage=${C.translucency}u;}
 textureStore(maskOut,p,vec4f(f32(mask)/255.0,0.0,0.0,0.0));
 textureStore(historyOut,p,vec4f(f32(coverage)/255.0,0.0,0.0,0.0));
}`,
    [...packedStorageWgsl(format), TAA_VIEW_WGSL, TRANSLUCENCY_WGSL],
  )
}
