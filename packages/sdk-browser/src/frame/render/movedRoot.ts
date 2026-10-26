import { rootBlends } from '../../geometry/selection/collectBlend.ts'
import { matrixWindingCw } from '../../../../math/src/matrix/orientation.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'

import { noteWorldMoved } from './movedWorlds.ts'
import { extendSpan } from '../../../../math/src/sequence/span.ts'
import { noteRootWorld } from '../../placement/roots/rootWorlds.ts'
import { worldMoved, worldVersion } from '../../geometry/selection/rootWorld.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** What a moved root rewrites: the memos its world feeds, its transparent entries' corners, and the
 *  runtime's list of moved placements, which names it (`movedWorlds.ts`). */
export type MovedRootTarget = Pick<WebgpuPagesRuntime, 'rootWorlds'> & {
  run?: Parameters<typeof noteWorldMoved>[0]
  blendState: {
    occlusionEpoch: number
    occlusionMoved?: { from: number; to: number }
    occlusionPosed?: { mark(entry: number): void }
    table?: { entryOf(page: number): number }
  }
}

/**
 * The world of one placement moved: only what reads it follows, and no word of a cluster is
 * written here. Its CPU box and stretch are taken again when read (`worldMoved`); its world goes to
 * the GPU (`rootWorlds.ts`), which the decode of the clusters it draws reads (`../../visibility/decode/`),
 * and the winding that picks each cluster's face mode is taken from it there. Placement `rank` is
 * named beside that send: its world alone goes up to the cut (`movedWorlds.ts`), and the GPU cut's
 * tree fits again the group of the pose its send says moved (`updateWorlds`). A transparent
 * placement's own transparent entries have their corners derived again (`occlusionPosed`).
 */
export function moveRootRows(rt: MovedRootTarget, root: ClusterRoot<PageRec>, rank: number) {
  worldMoved(root)
  if (rt.run) noteWorldMoved(rt.run, rank)
  noteRootWorld(rt, rank)
  poseEntries(rt, root)
  // Its winding is taken at its new world version (`winding.ts`).
  root.windingCw = matrixWindingCw(root.world.elements)
  root.windingEpoch = worldVersion(root)
}

/** A root's world moved — a move of its own, or its parent's composing it on the GPU
 *  (`../../placement/compose/gpuComposeSlot.ts`): a blended root's entries have their corners derived
 *  again from its world (`../../blend/transparent/entryCorners.ts`), every entry's without a table; an
 *  opaque root holds no entry. */
export function poseEntries(rt: Pick<MovedRootTarget, 'blendState'>, root: ClusterRoot<PageRec>) {
  if (!rootBlends(root)) return
  const { blendState } = rt
  eachEntry(
    blendState,
    blendState.occlusionPosed,
    root.packedBase ?? -1,
    0,
    root.pages.length - 1,
    markPosed,
  )
}

const markPosed = (posed: { mark(entry: number): void }, entry: number) => posed.mark(entry)

/** Each transparent entry of a blended root's pages `from` to `to`, from packed rank `base`, handed
 *  to `visit` with `target`; without a table, a target or a base, every entry's corners are derived
 *  again instead (`occlusionEpoch`). */
function eachEntry<Target>(
  blendState: MovedRootTarget['blendState'],
  target: Target | undefined,
  base: number,
  from: number,
  to: number,
  visit: (target: Target, entry: number) => void,
) {
  const { table } = blendState
  if (!table || !target || base < 0) {
    blendState.occlusionEpoch = -1
    return
  }
  for (let page = from; page <= to; page++) {
    const entry = table.entryOf(base + page)
    if (entry >= 0) visit(target, entry)
  }
}

/**
 * Declares a blended root's transparent entries of its pages `from` to `to` moved: their corners are
 * sent again (`eachEntry`). No pose moved here: a dynamic page's vertices lie in another box
 * (`PageRec.moved`), or its root holds another reach. An opaque root's clusters read their bounds
 * from the cut's own tables, so none of theirs is written.
 */
export function markRootEntries(
  rt: Pick<MovedRootTarget, 'blendState'>,
  root: ClusterRoot<PageRec>,
  from: number,
  to: number,
) {
  if (to >= from && rootBlends(root))
    eachEntry(
      rt.blendState,
      rt.blendState.occlusionMoved,
      root.packedBase ?? -1,
      from,
      to,
      extendSpan,
    )
}
