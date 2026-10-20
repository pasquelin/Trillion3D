import { rootBlends } from '../../../page/selection/collectBlend.ts'
import { matrixWindingCw } from '../../../../../math/src/matrix/orientation.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'

import type { WebgpuPagesLayout } from '../prepare/layout.ts'
import { noteWorldMoved } from './movedWorlds.ts'
import { extendSpan } from '../../../../../math/src/sequence/span.ts'
import { noteRootWorld } from '../../../placement/rootWorlds.ts'
import { worldMoved, worldVersion } from '../../../page/selection/rootWorld.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { ownPageRow } from '../../row/state.ts'

/** What a moved root rewrites: its rows and the memos its world feeds, and the runtime's list of
 *  moved placements, which names it (`movedWorlds.ts`). */
export type MovedRootTarget = Pick<WebgpuPagesRuntime, 'rootWorlds'> & {
  layout: Pick<WebgpuPagesLayout, 'rows'>
  run?: Parameters<typeof noteWorldMoved>[0]
  blendState: {
    occlusionEpoch: number
    occlusionMoved?: { from: number; to: number }
    occlusionPosed?: { mark(entry: number): void }
    table?: { entryOf(page: number): number }
  }
}

/**
 * The world of one placement moved: only what reads it follows, and no word of its rows is written
 * here. Its CPU box and stretch are taken again when read (`worldMoved`); its world goes to the
 * GPU (`rootWorlds.ts`), and the rows pass derives every word of its
 * rows from it (`../../../placement/rowWords.ts`): world words, sphere, corners, detail. Placement
 * `rank` is named beside that send: its world alone goes up to the cut (`movedWorlds.ts`), and the
 * GPU cut's tree fits again the group of the pose its send says moved (`updateWorlds`). A world
 * that turned its winding swaps the face every row of it culls: its rows are written again
 * (`markRootRows`), their draw bins made for the new one. A transparent placement claims no
 * visibility row: its caster rows move with it, and the corners of its own transparent entries are
 * derived again (`occlusionPosed`), never the table's. The
 * occlusion history of its rows is kept: a stale rectangle only moves a row between the two halves
 * of the partition, never a pixel (`../../../gpu/partition/projectWgsl.ts`). Returns the rows
 * written again.
 */
export function moveRootRows(rt: MovedRootTarget, root: ClusterRoot<PageRec>, rank: number) {
  worldMoved(root)
  if (rt.run) noteWorldMoved(rt.run, rank)
  noteRootWorld(rt, rank)
  poseEntries(rt, root)
  // Its winding is taken at its new world version, the one its bins are read at (`winding.ts`).
  const cw = matrixWindingCw(root.world.elements),
    turned = root.windingCw !== cw
  root.windingCw = cw
  root.windingEpoch = worldVersion(root)
  if (!turned) return 0
  return markRootRows(rt, root, 0, root.pages.length - 1)
}

/** A root's world moved — a move of its own, or its parent's composing it on the GPU
 *  (`../../../placement/gpuComposeSlot.ts`): a blended root's entries have their corners derived
 *  again from its world (`../../transparent/entryCorners.ts`), every entry's without a table; an
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
 * Declares the rows of `root`'s pages `from` to `to` dirty: their inputs, table words, draw bins and
 * every word the rows pass derives travel again for them alone, and a blended root's transparent
 * corners are sent again (`eachEntry`). No pose moved here: a dynamic page's vertices lie in
 * another box (`PageRec.moved`), its root holds another reach, or its world turned its winding.
 * Returns the rows marked.
 */
export function markRootRows(
  rt: MovedRootTarget,
  root: ClusterRoot<PageRec>,
  from: number,
  to: number,
) {
  const { rows } = rt.layout,
    base = root.packedBase ?? -1
  // A blended root's own entries' transparent corners are sent again (`occlusionMoved`).
  if (to >= from && rootBlends(root))
    eachEntry(rt.blendState, rt.blendState.occlusionMoved, base, from, to, extendSpan)
  let rewritten = 0
  for (let page = from; page <= to; page++) {
    // A blended cluster moves its caster row (`../../row/blendCasters.ts`), which is its own.
    const row = ownPageRow(rows, base + page, !!root.pages[page].transparent)
    if (!rows.pageTableFloats || row < 0) continue
    rows.markRowWords(row)
    rewritten++
  }
  return rewritten
}
