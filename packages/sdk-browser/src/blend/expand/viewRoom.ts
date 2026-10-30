import type { WebgpuBlendState } from '../state.ts'

/** The blocks of the instance list the items allow, at most: view 0's, one more where the items fall in several passes (the draws'
 *  views), one more where some is responsive, one more where some is a sky surface (the sky pass's view). A scene whose items move to more of them is mounted again (`needsMoreBlocks`, `../statics.ts`). */
export function instanceBlocks(
  blendState: Pick<WebgpuBlendState, 'translucencyPasses' | 'responsive' | 'skyItems'>,
) {
  const passes = blendState.translucencyPasses
  return (
    1 +
    Number((passes & (passes - 1)) !== 0) +
    Number(blendState.responsive) +
    Number(blendState.skyItems.length > 0)
  )
}

/** The plan or the items' filter words moved: the sums and the main class's look are taken again. */
export function forgetViews(blendState: Pick<WebgpuBlendState, 'capacities' | 'viewEpoch'>) {
  blendState.capacities.clear()
  blendState.viewEpoch++
}
