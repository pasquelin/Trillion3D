/**
 * THE LINKS OF THE COMPOSITION (`gpuCompose.ts`): the session's composition over its root list, a
 * parent's slot, the roots a call links and those a whole set no longer holds.
 */
import { MATRIX_VALUES } from '../../../math/src/batch/strides.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { packDoubles, PACKED_MATRIX_WORDS } from '../../../math/src/float/splitDouble.ts'
import { mirrorKey } from '../webgpu/cut/denseKeys.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { placedBy, type PlacementRows } from './rows.ts'
import { rootRankOfRow } from './update.ts'
import { noteRootWorld } from './rootWorlds.ts'
import { deriveRootRows } from './rowWords.ts'
import {
  createComposeState,
  growComposeState,
  seedMotion,
  slotMoved,
  type ComposeState,
} from './gpuComposeState.ts'
import { installComposedWorld, removeComposedWorld } from './gpuComposeWorld.ts'
import { readerViews, releaseReaderViews } from './composeReaders.ts'
import type { PlacementLink } from './gpuCompose.ts'

/** The session's composition over its root list: a growth appends to it, its links kept; a list
 *  shortened — another list — unlinks every root through the one unlink path (`unlinkHeld`) and
 *  lets every reader's views go plain, holding their last world (`releaseReaderViews`), before it
 *  is made again: no view keeps the old composition alive. */
export function composeState(rt: WebgpuPagesRuntime) {
  const roots = rt.layout.selectionRoots.length,
    state = rt.compose
  if (state && roots > state.roots) growComposeState(rt, state, roots)
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
    readers: PlacementLink[] = [],
    blended = new Map<PlacementRows, boolean>()
  for (const link of links) {
    const rank = rootRankOfRow(rt.layout.selectionRoots, link.rows, link.index)
    if (rank >= 0) {
      ranks.push(rank)
      rooted.push(link)
    }
    if (!blended.has(link.rows)) blended.set(link.rows, placedBy(rt.blendState.blendGpu, link.rows))
    if (rank < 0 || blended.get(link.rows)) readers.push(link)
  }
  return { ranks, rooted, readers }
}

/** The parent's slot: its own, or a new one at `world`, every per-slot table grown to hold it. */
export function takeSlot(
  state: ComposeState,
  parent: object,
  p: number | undefined,
  world: ArrayLike<number>,
) {
  const slot = p ?? state.freeSlots.pop() ?? state.slots++
  if (p !== undefined) return slot
  state.parentIds.set(parent, slot)
  state.ranksOf[slot] = []
  state.winding[slot] = undefined as unknown as boolean
  state.worlds = resized(state.worlds, state.slots * MATRIX_VALUES)
  state.previous = resized(state.previous, state.slots * MATRIX_VALUES)
  state.previous.set(world, slot * MATRIX_VALUES)
  return slot
}

/** Every root `slot` held and `ranks` does not keep follows no parent any more. */
export function unlinkHeld(
  rt: WebgpuPagesRuntime,
  state: ComposeState,
  slot: number,
  ranks: number[],
) {
  const { mobility } = rt.lights,
    held = state.ranksOf[slot],
    kept = new Set(ranks)
  for (const rank of held) {
    if (state.parentOf[rank] !== slot || kept.has(rank)) continue
    removeComposedWorld(state, rank)
    state.parentOf[rank] = NO_INDEX
    // Its world is the CPU's again: sent from it, its rows derived from it, the pages they leave
    // and enter staled.
    noteRootWorld(rt, rank)
    deriveRootRows(rt, rank)
    mirrorKey(state.rankList, rank, false)
    state.linksMoved.mark(rank)
    state.relinked.push(rank)
    mobility.follow(rank, -1)
    rt.run.gpuSelection?.composedPlacement(rank, false)
  }
  held.length = 0
  slotMoved(state, slot)
}

/** `ranks` follow `slot`, each at its link's local matrix. */
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
  slotMoved(state, slot)
  for (let k = 0; k < ranks.length; k++) {
    const rank = ranks[k],
      was = state.parentOf[rank]
    if (whole || was !== slot) held.push(rank)
    // A root linked already keeps its own motion; one another slot held leaves its lists.
    if (was === NO_INDEX) {
      seedMotion(rt, state, rank)
      mirrorKey(state.rankList, rank, true)
      state.relinked.push(rank)
    } else if (was !== slot) slotMoved(state, was)
    state.parentOf[rank] = slot
    rt.lights.mobility.follow(rank, slot)
    rt.run.gpuSelection?.composedPlacement(rank, true)
    packDoubles(state.locals, rank * PACKED_MATRIX_WORDS, links[k].local)
    state.localMats.set(links[k].local as ArrayLike<number>, rank * MATRIX_VALUES)
    state.linksMoved.mark(rank)
    installComposedWorld(rt, rank)
  }
}
