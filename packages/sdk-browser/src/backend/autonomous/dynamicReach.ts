import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts'

/**
 * How far each dynamic geometry's vertices lie from where its pages are bounded (#573,
 * `../../world/page/runtimePrimitive.ts`), held by the WebGL2 path's roots as a deformation's
 * reach: every cut grows their bounds by it (`../../page/cut/cut.ts`). It is this rewrite's, the
 * farthest a vertex lies now, not the farthest one ever went: the cut that reads it draws the
 * vertices that rewrite wrote. A root mounted in place after its geometry moved hears the reach
 * again from the world (`../../world/core/worldDynamic.ts`, `upload`), as a new session's do.
 * `revision` moves with the roots (`heldFloor.placements`): the roots of each geometry are listed
 * once per revision, so a rewrite touches only its own.
 */
export function createDynamicReach(roots: readonly ClusterRoot<PageRec>[], revision: () => number) {
  let listed = -1,
    byAttributes = new Map<object, ClusterRoot<PageRec>[]>()
  return {
    /** `attributes`' vertices lie up to `reach` from where their pages are bounded. */
    note(attributes: object, reach: number) {
      const now = revision()
      if (listed !== now) {
        listed = now
        byAttributes = new Map()
        for (const root of roots) {
          const own = root.pages[0]?.attributes
          if (!own) continue
          const list = byAttributes.get(own)
          if (list) list.push(root)
          else byAttributes.set(own, [root])
        }
      }
      for (const root of byAttributes.get(attributes) ?? []) root.reach = reach
    },
  }
}
