import { WORLD_SPACE_ROOT } from '../../visibility/shader/castingMark.ts'
import { castsWhileHidden } from '../../placement/hidden.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * THE ROOTS A VIEW DOES NOT DRAW WHATEVER ITS LISTS SAY (`../../geometry/selection/viewFilter.ts`, its
 * `forced`): an object that stands for a first-person one is hidden from the view that owns it, the
 * main camera's (the reference forces `bOwnerNoSee` on it); an object that casts while hidden, and is
 * hidden, is drawn by no view (`bCastHiddenShadow`). The shadow maps draw both all the same
 * (`MOBILITY_WORLD_SPACE`, `MOBILITY_HIDDEN_SHADOW`). Read once for each scene revision.
 */
interface Held {
  roots: unknown
  length: number
  revision: number
  main: number[]
  other: number[]
}
const held = new WeakMap<WebgpuPagesRuntime, Held>()

/** The ranks of the roots the view does not draw: those hidden that cast, and, for the main view
 *  (`main`), the stand-ins of first-person objects. The same array until the scene moves. */
export function hiddenFromViews(rt: WebgpuPagesRuntime, main: boolean): readonly number[] {
  const roots = rt.layout.selectionRoots,
    revision = rt.run.gate.revisions.scene
  let kept = held.get(rt)
  if (!kept || kept.roots !== roots || kept.length !== roots.length || kept.revision !== revision) {
    const next: Held = { roots, length: roots.length, revision, main: [], other: [] }
    for (let rank = 0; rank < roots.length; rank++) {
      const root = roots[rank]!,
        mark = root.mark ?? 0
      const castsHidden = !!root.hidden && castsWhileHidden(root)
      if (castsHidden || mark & WORLD_SPACE_ROOT) next.main.push(rank)
      if (castsHidden) next.other.push(rank)
    }
    held.set(rt, (kept = next))
  }
  return main ? kept.main : kept.other
}
