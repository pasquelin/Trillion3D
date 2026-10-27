import { OBJECT_ONLY_OWNER_SEE, OBJECT_OWNER_NO_SEE } from '../../geometry/rows/page/offsetRow.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { appendRootsUnder } from './movedNode.ts'

/**
 * THE ROOTS A VIEW DOES NOT DRAW WHATEVER ITS LISTS SAY (`../../geometry/selection/viewFilter.ts`, its
 * `forced`): an object that casts while hidden, and is hidden, is drawn by no view (`bCastHiddenShadow`);
 * and what the view's owner sees of it (`Camera.owner`): a view is the owner's, and owns an object, when
 * its camera's owner is the object or a node above it, and it does not draw an object that is owned and
 * sets `ownerNoSee`, or is not owned and sets `onlyOwnerSee`. An object that stands for a first-person
 * one is `ownerNoSee` whatever it sets (the reference forces it); until a camera names an owner, the
 * main view alone is taken for the owner's and hides it. The shadow maps draw the world-space
 * representation and the object that casts while hidden all the same (`MOBILITY_WORLD_SPACE`,
 * `MOBILITY_HIDDEN_SHADOW`). The roots that may be hidden from a view are the layout's sparse sets
 * (`viewHidden.ts`): each owner's list is derived from them, once for as long as they, the roots' index by node and the scene stand.
 */

/** The views that name no owner: the main view, which takes the stand-ins of first-person objects
 *  for its owner's, and the others. */
const MAIN_VIEW = {}
const OTHER_VIEW = {}

/** The roots under an owner, and the set of them, scratch. */
const under: number[] = []
const owned = new Set<number>()

/** The ranks of the roots the view does not draw: those hidden that cast, and those its owner does
 *  not see (`owner`; with none, the stand-ins of first-person objects for the main view
 *  (`main`) and the objects that only an owner sees). The same array until the scene moves. */
export function hiddenFromViews(
  rt: WebgpuPagesRuntime,
  main: boolean,
  owner: Object3D | null,
): readonly number[] {
  const { layout, vis } = rt,
    hidden = layout.viewHidden
  hidden.sync(layout.selectionRoots.length, layout.rootIndex.revision, rt.run.gate.revisions.scene)
  const key = owner ?? (main ? MAIN_VIEW : OTHER_VIEW)
  let list = hidden.lists.get(key)
  if (!list) {
    hidden.lists.set(key, (list = []))
    // The roots the owner's view owns. With none, nothing is owned, and the stand-ins of first-person objects
    // keep the main view's rule.
    owned.clear()
    if (owner)
      for (let k = 0, end = appendRootsUnder(layout, owner, under, 0); k < end; k++)
        owned.add(under[k]!)
    for (const rank of hidden.ranks) {
      const bits = vis.rootOffsets.rowOf(rank)?.bits ?? 0,
        standIn = hidden.isStandIn(rank),
        noSee = (bits & OBJECT_OWNER_NO_SEE) !== 0 || standIn,
        isOwned = owner ? owned.has(rank) : main && standIn
      if (
        hidden.isCaster(rank) ||
        (isOwned && noSee) ||
        (!isOwned && (bits & OBJECT_ONLY_OWNER_SEE) !== 0)
      )
        list.push(rank)
    }
  }
  return list
}

/** The ranks of the roots that stand, in the world, for a first-person object (`WORLD_SPACE_ROOT`), by rank: read with the lists of
 *  `hiddenFromViews`, again when they change. The same array until the scene moves. */
export function worldSpaceRanks(rt: WebgpuPagesRuntime): readonly number[] {
  const { layout } = rt
  layout.viewHidden.sync(
    layout.selectionRoots.length,
    layout.rootIndex.revision,
    rt.run.gate.revisions.scene,
  )
  return layout.viewHidden.standInRanks
}
