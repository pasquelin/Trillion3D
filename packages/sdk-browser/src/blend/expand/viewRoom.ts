import type { WebgpuBlendState } from '../state.ts'

/** The blocks of the instance list the items allow, at most: view 0's, one more where the items fall in several passes (the draws'
 *  views), one more where some is responsive. A scene whose items move to more of them is mounted again (`needsMoreRoom`). */
export function instanceBlocks(
  blendState: Pick<WebgpuBlendState, 'translucencyPasses' | 'responsive'>,
) {
  const passes = blendState.translucencyPasses
  return 1 + Number((passes & (passes - 1)) !== 0) + Number(blendState.responsive)
}

/** The plan or the items' filter words moved: the sums and the main class's look are taken again. */
export function forgetViews(blendState: Pick<WebgpuBlendState, 'capacities' | 'viewEpoch'>) {
  blendState.capacities.clear()
  blendState.viewEpoch++
}
