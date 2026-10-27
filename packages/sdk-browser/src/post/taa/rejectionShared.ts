/** What the shading rejection and the flicker measure inside it (`flickerMeasureWgsl.ts`) share: the display's step error, the
 *  analysis views and the flicker gates, the values brought onto each other. */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { DISPLAY_STEP_ERROR, type Precision } from './colorSpaceWgsl.ts'
import { LANE_ROWS, networkOf } from './rejectionNetworkWgsl.ts'
import type { Wave } from './waveOps.ts'

/** The display's step error `Q`, which the shading rejection and the flicker measure (`flickerMeasureWgsl.ts`) widen their clamps by. */
export const DISPLAY_STEP_ERROR_WGSL = wgslBlock(
  'DISPLAY_STEP_ERROR_WGSL',
  [],
  `const Q=${wgslF32(DISPLAY_STEP_ERROR)};`,
)

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

/** The conditions the flicker measure (`flickerMeasureWgsl.ts`) runs and its error is read under:
 *  `flickerRejects`, the level rejects by the flicker (`view.quality.x`) and the error widens the
 *  clamp; `analysisShown`, an analysis view is shown, which alone shows the count; `flickerMeasured`,
 *  the measure runs — either of them; `thinAntiFlickers`, the measure considers the thin geometry
 *  detection's relaxation (`view.rates.w`, `temporalThinGeometryAntiFlickering`); `shadingResponsive`, the
 *  shading rejection is in its responsive mode (`view.rates.z`, `temporalShadingRejectionMode`), which the measure's clamp error follows. */
export const FLICKER_GATES_WGSL = wgslBlock(
  'FLICKER_GATES_WGSL',
  [TAA_VIEW_WGSL],
  `
fn flickerRejects()->bool{return view.quality.x>0.0;}
fn analysisShown()->bool{return view.params.w>=${FIRST_ANALYSIS_VIEW}.0;}
fn flickerMeasured()->bool{return flickerRejects()||analysisShown();}
fn thinAntiFlickers()->bool{return view.rates.w>0.0;}
fn shadingResponsive()->bool{return view.rates.z>0.0;}`,
)

/** The filtering weight of the binomial 3×3's centre: `1 / (1 + 4·½ + 4·¼)`. */
export const FILTERING_WEIGHT = 1 / (1 + 4 * 0.5 + 4 * 0.25)
/** Each of two values held in the 3×3 box of the other. */
const annihilateText = () => `/** \`v\` held in the box \`b\`. */
fn heldIn(v:Px,b:Box)->Px{
 var o:Px;
 for(var r=0;r<${LANE_ROWS};r++){o[r]=clamp(v[r],b.lo[r],b.hi[r]);}
 return o;
}
/** \`toClamp\` held in the 3×3 box of \`guide\` held in the 3×3 box of \`toClamp\` (\`own\`, its 3×3 box): each
 *  brought onto the other where they overlap. */
fn annihilateToGuide(toClamp:Px,guide:Px,own:Box)->Px{return heldIn(toClamp,minMax3x3(heldIn(guide,own)));}`

/** The values held in each other's box, which the shading rejection and the flicker measure
 *  (`flickerMeasureWgsl.ts`) both bring onto each other. */
export const annihilateWgsl = (p: Precision, wave?: Wave) =>
  wgslBlock(`REJECT_SHADING_ANNIHILATE${p.S}_WGSL`, networkOf(p, wave), annihilateText())
