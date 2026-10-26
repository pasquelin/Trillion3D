import type { TranslucencyPass } from '../../../sdk-core/src/world/constants/index.ts'

/**
 * THE PASSES OF THE TRANSLUCENCY, as codes and sets. A see-through surface says which pass of the
 * image it is drawn in (`Material.translucencyPass`, `ParticlePool.translucencyPass`); the code of a
 * pass is the one the records report (`ITEM_NEEDS.passShift`) and the expansion filters by (`itemFilterWord`), its bit the one the sets of passes
 * (`blendState.translucencyPasses`) and a draw's (`LayerDraw.only`, 0 for every pass) are made of.
 */
const TRANSLUCENCY_PASS_CODE = {
  beforeDepthOfField: 1,
  afterDepthOfField: 2,
  afterMotionBlur: 3,
} as const satisfies Record<TranslucencyPass, number>

/** The code of `pass`, the default's where a surface names none. */
export const translucencyPassCode = (pass: TranslucencyPass | undefined) =>
  TRANSLUCENCY_PASS_CODE[pass ?? 'afterDepthOfField']

/** The bit of `pass` in a set of passes. */
export const translucencyPassBit = (pass: TranslucencyPass | undefined) =>
  1 << translucencyPassCode(pass)

/** The set of passes of a list of pools: the bits of their passes. */
export function poolPasses(pools: readonly { translucencyPass: TranslucencyPass }[] | undefined) {
  let passes = 0
  for (const pool of pools ?? []) passes |= translucencyPassBit(pool.translucencyPass)
  return passes
}
