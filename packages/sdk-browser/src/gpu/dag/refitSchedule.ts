import { TREE_SPAN, type PlacementTree } from './placementTree.ts'

/**
 * THE ONE REFIT SCHEDULE: the nodes to fit at each of `levels` levels once `touched` changed, bottom up
 * — the deepest level (`levels − 1`) first, level 0 the root's —, each level's ids increasing. A level
 * holds the nodes touched at it and the parents (`above`) of those the level below holds, and, when
 * `own` names them, the nodes it always holds: a fit of a whole structure names its nodes by level,
 * the fit of a change names the groups the change touched. The placement tree's refit
 * (`refitLevels`) and a mesh's proxy pose (`bounce/runtimePoseLevels.ts`) fit their boxes by it.
 */
export function refitSchedule(
  levels: number,
  touched: Iterable<number>,
  above: (level: number, id: number) => number,
  own?: (level: number) => Iterable<number>,
) {
  let carried = new Set(touched)
  const schedule: { level: number; ids: Uint32Array<ArrayBuffer> }[] = []
  for (let l = levels - 1; l >= 0; l--) {
    const here = new Set(carried)
    if (own) for (const id of own(l)) here.add(id)
    if (!here.size) {
      carried = here
      continue
    }
    schedule.push({ level: l, ids: new Uint32Array([...here].sort((a, b) => a - b)) })
    const parents = new Set<number>()
    if (l > 0) for (const id of here) parents.add(above(l, id))
    carried = parents
  }
  return schedule
}

/** The nodes to fit at each level of `tree` once `groups` changed, bottom up: each level's, as
 *  their index within it, increasing (`refitSchedule`). */
export const refitLevels = (tree: PlacementTree, groups: Iterable<number>) =>
  refitSchedule(tree.levels.length, groups, (_level, id) => Math.floor(id / TREE_SPAN))
