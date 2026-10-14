import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { createSessionCut } from '../webgpu/pages/prepare/cut.ts'
import { holdGrownWorlds, keepMovesFor } from './growthAnnounce.ts'
import { dagRootCounts, type DagCapacity } from '../gpu/dag/packCapacity.ts'
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { GrowthInFlight } from './webgpuGrowth.ts'

/** THE GROWN CUT STARTED (`webgpuGrowth.ts`), at frame entry: the roots appended in place, or a
 *  cut over every root made beside the running one, which the swap adopts (`webgpuGrownCut.ts`). */

/** At frame entry: the roots the growths since the last image brought, appended in place into the
 *  running cut's room, or a cut over every root made beside it at a grown capacity. */
export function startGrownCut(rt: WebgpuPagesRuntime) {
  const growth = rt.growth
  if (!growth?.asked) return
  const cut = rt.run.gpuSelection
  // A list growing between two frames takes no root: asked again at the next frame entry, rather
  // than a whole cut packed for a growth that ends within a frame or two. Nor while a cut is made
  // beside it: one cut is made at a time, the roots that came meanwhile asked once it landed — a
  // stream of sources joining over many images never holds the tables of several cuts at once.
  if (cut?.growing || growth.making) return
  growth.asked = false
  const added = growth.roots.slice(growth.appended)
  // Copies alone bring no root: the running cut holds what they join.
  if (cut && (!added.length || cut.appendRoots(added))) {
    // The worlds the host sends hold theirs at once, at their ranks.
    holdGrownWorlds(
      rt.layout.worldUpdates,
      added,
      rt.layout.selectionRoots.length + growth.appended,
    )
    // No cut made beside it will be adopted: the moves are its own.
    rt.run.movedWorlds.since = undefined
    growth.appended = growth.roots.length
    // One landed beside it, unadopted, is for fewer roots: released.
    dropLanded(growth)
    const roots = rt.layout.selectionRoots.length + growth.roots.length
    growth.ready = { cut, roots, moved: new Set(), inPlace: true }
    return
  }
  growth.making = makeCut(rt, growth).finally(() => (growth.making = undefined))
}

/** The capacity a cut over `roots` is packed at: twice the pages and placements the session held
 *  at least (`grownLength`), nodes in the pages' proportion, and room for the primitives and
 *  sources later growths bring (`ahead`). */
function grownCutCapacity(rt: WebgpuPagesRuntime, roots: readonly ClusterRoot<PageRec>[]) {
  const needed = dagRootCounts(roots),
    pages = grownLength(rt.layout.packedPages.length, needed.pages)
  return {
    pages,
    nodes: ceilDiv(needed.nodes * pages, Math.max(1, needed.pages)),
    worlds: grownLength(rt.layout.selectionRoots.length, needed.worlds),
    ahead: true,
  }
}

/** The cut made beside the running one, landed and never adopted, released — not one over `roots`
 *  roots, which is the cut asked: the one place a ready cut is let go before its adoption. */
function dropLanded(growth: GrowthInFlight, roots?: number) {
  const { ready } = growth
  if (!ready || ready.inPlace || ready.roots === roots) return
  ready.cut.dispose()
  growth.ready = undefined
}

/** The GPU cut over the session's roots and those waiting, made beside the running one, one at a
 *  time (`growth.making`). The pool's slots that move meanwhile are logged (`logTouched`) and replayed
 *  alone at the swap (`webgpuGrownCut.ts`). */
async function makeCut(rt: WebgpuPagesRuntime, growth: GrowthInFlight): Promise<void> {
  const roots = [...rt.layout.selectionRoots, ...growth.roots],
    { rows } = rt.layout,
    moved = new Set<number>()
  // A cut made for fewer roots, landed but never adopted, is no cut this one can wait for: its
  // tables are released before this one's are asked.
  dropLanded(growth, roots.length)
  growth.moved = moved
  rows.logTouched(moved)
  // The poses named while it is made reach it at its swap (`replayMoves`).
  keepMovesFor(rt)
  // The pool as it stands, in one write; what moves meanwhile follows at adoption (`swapCut`).
  const held = (page: number) => heldPage(rt, page)
  const capacity = grownCutCapacity(rt, roots)
  const make = (room: DagCapacity) =>
    createSessionCut(rt, rt.gpu.device!, roots, held, room)
      .then((result) => ({ ...result, error: undefined as unknown }))
      .catch((failure: unknown) => ({ cut: undefined, refused: 'creation failed', error: failure }))
  let attempt = await make(capacity)
  // The room kept for the primitives and sources to come is an advance, not a need: a device that
  // cannot hold the cut with it is asked for the cut over the roots at the grown pages and
  // placements alone.
  if (!attempt.cut && !rt.signal.aborted && !rt.run.lost)
    attempt = await make({ ...capacity, ahead: false })
  const { cut, refused, error } = attempt
  if (rt.signal.aborted || rt.run.lost) return cut?.dispose()
  rows.logTouched(undefined)
  // The scene's roots no longer fit a cut this device holds: as an open would be, it is refused.
  // The running cut goes on and the roots wait parked, as for any content the session cannot take:
  // said by name by the owner (`onContentRefused`), never a lost device.
  if (!cut) {
    rt.run.movedWorlds.since = undefined
    growth.asked = false
    const cause = error === undefined ? refused : `${refused}: ${String(error)}`
    return rt.context.onContentRefused?.(
      'the rows the scene gained',
      `the device refused the cut over them (${cause})`,
    )
  }
  // The running cut that took roots in place stays the session's until this one replaces it.
  dropLanded(growth)
  growth.ready = { cut, roots: roots.length, moved }
}

/** Whether packed page `page` — of the roots the session holds — has its bytes in the pool. */
export const heldPage = (rt: WebgpuPagesRuntime, page: number) => rt.layout.rows.offsetOf(page) >= 0
