import { countsBlendOverdraw } from '../diagnostic/gpuVariant.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { effectsShown, stagePlan } from '../post/effects/stagePlan.ts'
import { poolPasses, translucencyPassBit } from './translucencyPasses.ts'

/**
 * THE PASSES OF THE TRANSLUCENCY (`translucencyPasses.ts`): `afterDepthOfField`, the default, apart
 * from the scene and composed over the image once the depth of field has read it, so that no blur
 * reaches it; `beforeDepthOfField`, composed onto the scene before the depth of field, which blurs
 * it with the scene it lies in; `afterMotionBlur`, in a set of targets of its own, composed over
 * the image once the temporal pass and the motion blur have read it, so that neither smears it.
 * With the depth of field drawn on the image and layers in both of the first two, the same draws
 * run twice, the pass before first; a layer of the last is always drawn apart (`encodeBlend`).
 * Each draw expands and draws the items of its own passes alone: the expansion is made once for
 * each (`expand/expansionViews.ts`), so no vertex of another pass's item is ever processed.
 */

/** The set of passes the image's layers are drawn in: its items' and its pools'. */
export const imagePasses = ({
  blendState,
  context,
}: Pick<WebgpuPagesRuntime, 'blendState' | 'context'>) =>
  blendState.translucencyPasses | poolPasses(context.particles)

/** Whether this image splits its layers by pass: the depth of field is drawn on it, and the counting
 *  variant does not measure the pass whole. Else every layer of the passes before the motion blur is
 *  drawn at once and composed after the depth of field's place, where there is none. */
export function splitsTranslucency(rt: WebgpuPagesRuntime) {
  if (!effectsShown(rt) || countsBlendOverdraw(rt.context?.diagnosticGpuVariant)) return false
  return !!stagePlan(rt, 'before-resolve')?.passes.some((pass) => pass.kind === 'depthOfField')
}

/** One draw of the image's layers, by its rank `at` (0 the layers of the pass before the depth of field, 1 the others, 2 the pass after
 *  the motion blur): whether the image makes it (`active`, a set of passes with a layer), and `only`, the set of passes it keeps (the bits
 *  of `translucencyPassBit`) — 0 where the image has a lone draw, which draws every layer. */
export type LayerDraw = { at: number; active: boolean; only: number }
const draws: readonly LayerDraw[] = [0, 1, 2].map((at) => ({ at, active: false, only: 0 }))

/** The draws of this image's layers, refilled (the same three objects, in order): with the depth of field drawn, the layers of the
 *  pass before it go first and are composed at once; the others follow, and the layers of the pass after the motion blur last. A set of
 *  passes with no layer is not drawn, and a lone draw draws every layer. */
export function layerDraws(rt: WebgpuPagesRuntime): readonly LayerDraw[] {
  const passes = imagePasses(rt),
    bit = translucencyPassBit
  const before = splitsTranslucency(rt) ? passes & bit('beforeDepthOfField') : 0
  const middle = passes & (bit('beforeDepthOfField') | bit('afterDepthOfField')) & ~before
  const late = rt.gpu.translucency?.late?.active ? passes & bit('afterMotionBlur') : 0
  const several = Number(!!before) + Number(!!middle) + Number(!!late) > 1
  draws[0].active = !!before
  draws[1].active = !!middle
  draws[2].active = !!late
  draws[0].only = several ? before : 0
  draws[1].only = several ? middle : 0
  draws[2].only = several ? late : 0
  return draws
}
