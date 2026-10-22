import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { TAA_VIEW_WGSL } from './bindingsWgsl.ts'
import { FLICKER_LUMA_WGSL } from './colorSpaceWgsl.ts'
import { flickerRegions, flickerStages } from './flickerStages.ts'
import { FLICKER_FORMAT, REPROJECTED_WORD_WGSL } from './reprojectWgsl.ts'
import { CLOSEST_FORMAT } from './velocityWgsl.ts'
import { SAFE_RCP_WGSL } from './historyWgsl.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../../gpu/core/textureLimits.ts'
import {
  NINE_OPERATORS_WGSL,
  TILE_CLAMP_WGSL,
  TILE_WORDS_WGSL,
  tileEntry,
  tileWords,
  type TilePlan,
} from './tileWgsl.ts'

/** The flicker measure's tile and the border its chain of nine 3×3 operators reads: 16×8, the
 *  widest whose network fits the workgroup memory every device holds. */
export const FLICKER_PLAN: TilePlan = { width: 16, height: 8, border: 9 }
/** The same network over 16×16 tiles, for a device that holds the workgroup memory it needs
 *  (`flickerPlanFor`): 25.7 stage evaluations a texel written against 35.8, the same image — every
 *  texel written is exact whatever the tile. */
const FLICKER_WIDE_PLAN: TilePlan = { width: 16, height: 16, border: 9 }

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
  thin: 9,
} as const

/** The flicker error of each render texel, an f32's bits (`flickerShader`), written over the closest
 *  depth word of the texel (`CLOSEST_FORMAT`), which the reprojection read before. */
export const FLICKER_ERROR_FORMAT = CLOSEST_FORMAT

/** The tile of the flicker measure on a device holding `workgroupBytes` of workgroup memory: the
 *  wide one where its network fits, else `FLICKER_PLAN`. */
export const flickerPlanFor = (workgroupBytes: number) =>
  flickerRegions(FLICKER_WIDE_PLAN).modified.end * 4 <= workgroupBytes
    ? FLICKER_WIDE_PLAN
    : FLICKER_PLAN

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
 * flicker history, the marks and the reprojection word. Where the thin geometry detection does not
 * run (`view.quality.w`), its mask reads none: the relaxation's stage is left out and no texel is a
 * thin geometry region.
 *
 * The tile is `plan`'s, within the `workgroupBytes` of workgroup memory the device holds.
 */
export const flickerShader = (
  plan: TilePlan = FLICKER_PLAN,
  workgroupBytes = GUARANTEED_WORKGROUP_BYTES,
) =>
  wgslProgram(
    `@group(0) @binding(${FLICKER_BINDINGS.view}) var<uniform> view:TaaView;
@group(0) @binding(${FLICKER_BINDINGS.current}) var current:texture_2d<f32>;
@group(0) @binding(${FLICKER_BINDINGS.reactive}) var reactive:texture_2d<f32>;
@group(0) @binding(${FLICKER_BINDINGS.word}) var reprojected:texture_2d<u32>;
@group(0) @binding(${FLICKER_BINDINGS.flicker}) var flicker:texture_2d<f32>;
@group(0) @binding(${FLICKER_BINDINGS.marks}) var marks:texture_2d<u32>;
@group(0) @binding(${FLICKER_BINDINGS.flickerOut}) var flickerOut:texture_storage_2d<${FLICKER_FORMAT},write>;
@group(0) @binding(${FLICKER_BINDINGS.error}) var errorOut:texture_storage_2d<${FLICKER_ERROR_FORMAT},write>;
@group(0) @binding(${FLICKER_BINDINGS.thin}) var thin:texture_2d<u32>;
${tileWords(flickerRegions(plan).modified.end, 0, workgroupBytes)}
${tileEntry(plan, 'flickerMeasure')}
${flickerStages(plan)}
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
