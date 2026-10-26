import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** The growth of `rt`, begun when none is (`webgpuGrowth.ts`). */
export const growing = (rt: WebgpuPagesRuntime) =>
  (rt.growth ??= { roots: [], copies: [], appended: 0, asked: false })

/** The session asks for a cut that can take the groups above its instances' roots, over the roots
 *  it holds: the running cut's node table has no room for the node of one, or the leaves of its
 *  placement tree hold no ball for it, its packing having named none
 *  (`GpuSelection.rootParentWorld`). Taken at the next frame entry, a burst of them making one cut
 *  (`startGrownCut`). */
export function askNodeRoom(rt: WebgpuPagesRuntime) {
  const growth = growing(rt)
  growth.asked = true
  growth.starved = true
}
