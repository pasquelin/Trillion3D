/**
 * THE LINKS OF THE COMPOSITION (`gpuCompose.ts`): the session's composition over its root list, a
 * parent's slot, the roots a call links and those a whole set no longer holds.
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { sameElements } from '../../../../math/src/matrix/matrixElements.ts'
import { packDoubles, PACKED_MATRIX_WORDS } from '../../../../math/src/float/splitDouble.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { rootRankOfRow } from '../update.ts'
import { noteRootWorld } from '../roots/rootWorlds.ts'
import {
  createComposeState,
  growComposeState,
  slotMoved,
  type ComposeState,
} from './gpuComposeState.ts'
import { installComposedWorld, removeComposedWorld } from './gpuComposeWorld.ts'
import { worldMoved } from '../../geometry/selection/rootWorld.ts'
import { readerViews, releaseReaderViews } from './composeReaders.ts'
import { noteMovedRank } from '../roots/rootMoves.ts'
import type { PlacementLink } from './gpuCompose.ts'

/** The session's composition over its root list: a growth appends to it, its links kept; a list
 *  shortened — another list — unlinks every root through the one unlink path (`unlinkHeld`) and
 *  lets every reader's views go plain, holding their last world (`releaseReaderViews`), before it
 *  is made again: no view keeps the old composition alive. */
export function composeState(rt: WebgpuPagesRuntime) {
  const roots = rt.layout.selectionRoots.length,
    state = rt.compose
  if (state && roots > state.roots) growComposeState(state, roots)
  else if (state && roots < state.roots) {
    for (let slot = 0; slot < state.ranksOf.length; slot++)
      if (state.ranksOf[slot]?.length) unlinkHeld(rt, state, slot, [])
    const viewsOf = readerViews(rt.blendState.blendGpu)
    for (const slot of state.readers.keys()) releaseReaderViews(state.readers, slot, viewsOf)
    state.gpu?.dispose()
    rt.compose = undefined
  }
  return (rt.compose ??= createComposeState(roots))
}

/** The root rank of each link a root reads (`ranks`, with those links as `rooted`), and the links
 *  whose rows only a CPU reader holds — no root reads them, or a blended copy does too: composed for
 *  that reader (`composeReaders.ts`). A link is never refused for what reads its row: waves, a soft
 *  body or a skeleton read the root's world, which a composed root gives as it is read. */
export function linkedRanks(rt: WebgpuPagesRuntime, links: readonly PlacementLink[]) {
  const ranks: number[] = [],
    rooted: PlacementLink[] = [],
    readers: PlacementLink[] = []
  for (const link of links) {
    const rank = rootRankOfRow(rt.layout.selectionRoots, link.rows, link.index)
    if (rank >= 0) {
      ranks.push(rank)
      rooted.push(link)
    }
    if (rank < 0 || link.rows.blended) readers.push(link)
  }
  return { ranks, rooted, readers }
}

/** The parent's slot: its own, or a new one, every per-slot table grown to hold it. */
export function takeSlot(state: ComposeState, parent: object, p: number | undefined) {
  const slot = p ?? state.freeSlots.pop() ?? state.slots++
  if (p !== undefined) return slot
  state.parentIds.set(parent, slot)
  state.ranksOf[slot] = []
  state.worlds = resized(state.worlds, state.slots * MATRIX_VALUES)
  return slot
}

/** The ranks an unlink keeps, made once. */
const kept = new Set<number>()

/** Every root `slot` held and `ranks` does not keep follows no parent any more: true when one did. */
export function unlinkHeld(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  slot: number,
  ranks: number[],
) {
  const { mobility } = rt.lights,
    held = state.ranksOf[slot]
  kept.clear()
  for (const rank of ranks) kept.add(rank)
  let unlinked = false
  for (const rank of held) {
    if (state.parentOf[rank] !== slot || kept.has(rank)) continue
    unlinked = true
    removeComposedWorld(state, rank)
    state.parentOf[rank] = NO_INDEX
    // Its world is no longer composed: what derives from it is taken again (`worldMoved`).
    const root = rt.layout.selectionRoots[rank]
    if (root) worldMoved(root)
    // Its world is the CPU's again: sent from it.
    noteRootWorld(rt, rank)
    state.rankList.remove(rank)
    state.linksMoved.mark(rank)
    mobility.follow(rank, -1)
    rt.run.gpuSelection?.composedPlacement(rank, false)
  }
  held.length = 0
  if (unlinked) slotMoved(state, slot)
  return unlinked
}

/** `ranks` follow `slot`, each at its link's local matrix; true when one joined it or changed its
 *  local, which alone the next worlds pass composes again (`ComposeState.composed`). A link that
 *  stands as held is skipped: nothing sent, nothing marked, no move told. */
export function linkRanks(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  {
    slot,
    ranks,
    links,
    whole,
  }: { slot: number; ranks: number[]; links: readonly PlacementLink[]; whole: boolean },
) {
  const held = state.ranksOf[slot]
  let changed = false
  for (let k = 0; k < ranks.length; k++) {
    const rank = ranks[k],
      was = state.parentOf[rank],
      local = links[k].local
    if (whole || was !== slot) held.push(rank)
    if (was === slot && sameElements(state.localMats, local, rank * MATRIX_VALUES)) continue
    changed = true
    // One joining leaves the lists of the slot it left.
    if (was !== slot) {
      slotMoved(state, slot)
      if (was !== NO_INDEX) slotMoved(state, was)
    }
    if (was === NO_INDEX) state.rankList.add(rank)
    state.parentOf[rank] = slot
    rt.lights.mobility.follow(rank, slot)
    rt.run.gpuSelection?.composedPlacement(rank, true)
    packDoubles(state.locals, rank * PACKED_MATRIX_WORDS, local)
    state.localMats.set(local as ArrayLike<number>, rank * MATRIX_VALUES)
    state.linksMoved.mark(rank)
    noteMovedRank(state.composed, rank)
    installComposedWorld(rt, rank)
  }
  return changed
}
