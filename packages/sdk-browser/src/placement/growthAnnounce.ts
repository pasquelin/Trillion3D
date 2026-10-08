import { noteWorldMoved } from '../webgpu/pages/render/movedWorlds.ts'
import { createSortedKeys, takeSorted } from '../webgpu/cut/denseKeys.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/**
 * The roots a growth `added` behind rank `first`, announced to the next image: placed by rows —
 * every root a growth brings is —, their worlds are the rows' (`updateWebgpuPlacements` wrote
 * them), named and sent alone, the scene's shape kept: no host walk, O(roots added).
 */
export function announceGrowth(
  rt: Pick<WebgpuPagesRuntime, 'run'>,
  added: readonly unknown[],
  first: number,
) {
  for (let k = 0; k < added.length; k++) noteWorldMoved(rt.run, first + k)
  rt.run.gate.engineMovedInPlace()
}

/** A cut is packed beside the running one from now on: every pose named — or a host walk — is
 *  kept for it until its swap (`replayMoves`). */
export function keepMovesFor(rt: Pick<WebgpuPagesRuntime, 'run'>) {
  rt.run.movedWorlds.since = { ranks: createSortedKeys(), walked: false }
}

/** Roots a growth added, as their worlds are read. */
export type GrownRoots = readonly { readonly world: { readonly elements: ArrayLike<number> } }[]

/** The worlds the host sends, `worlds`, holding those of the roots `added` behind rank `first`
 *  — the cut that takes them packed them so —: a send before their next pose compares them as the
 *  cut holds them, never as zeros. O(roots added). */
export function holdGrownWorlds(worlds: Float32Array, added: GrownRoots, first: number) {
  for (let k = 0; k < added.length; k++) worlds.set(added[k].world.elements, (first + k) * 16)
}

/**
 * The poses that moved since `cut` was packed, given to it at its swap as park and mark are: the
 * worlds the session sent since — those named, or every one after a host walk —, with their exact
 * translations and stretch; its tree follows the poses its send moved. The roots `added` behind
 * rank `first`, which it packed, are held first (`holdGrownWorlds`). O(moves), never a walk of
 * every world unless the host walked them.
 */
export function replayMoves(
  rt: Pick<WebgpuPagesRuntime, 'run' | 'layout'>,
  cut: Pick<GpuSelection, 'updateWorlds'>,
  added: GrownRoots,
  first: number,
) {
  const since = rt.run.movedWorlds.since,
    worlds = rt.layout.worldUpdates
  holdGrownWorlds(worlds, added, first)
  rt.run.movedWorlds.since = undefined
  if (!since) return
  if (since.walked) return void cut.updateWorlds(worlds)
  const ranks = takeSorted(since.ranks)
  if (ranks.length) cut.updateWorlds(worlds, ranks)
}
