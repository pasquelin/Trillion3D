import { matrixWindingCw } from '../../../../../sdk-core/src/index.ts'
import type { ClusterRoot } from '../../../page/selection/types.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import type { WebgpuPagesLayout } from '../prepare/layout.ts'
import { noteWorldMoved } from './movedWorlds.ts'
import { extendSpan } from '../../../../../math/src/sequence/span.ts'
import { noteRootWorld } from '../../../placement/rootWorlds.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** What a moved root rewrites: its rows and the memos its world feeds, and the runtime's list of
 *  moved placements, which names it (`movedWorlds.ts`). */
export type MovedRootTarget = Pick<WebgpuPagesRuntime, 'rootWorlds'> & {
  layout: Pick<WebgpuPagesLayout, 'rows'>
  run?: Parameters<typeof noteWorldMoved>[0]
  blendState: {
    occlusionEpoch: number
    occlusionMoved?: { from: number; to: number }
    table?: { entryOf(page: number): number }
  }
}

/**
 * The world of one placement moved: only what reads it follows, and no word of its rows is written
 * here. Its world goes to the GPU (`rootWorlds.ts`), and the rows pass derives every word of its
 * rows from it (`../../../placement/rowWords.ts`): world words, sphere, corners, detail. Placement
 * `rank` is named beside that send: its world alone goes up to the cut (`movedWorlds.ts`), and the
 * GPU cut's tree fits again the group of the pose its send says moved (`updateWorlds`). A world
 * that turned its winding swaps the face every row of it culls: its rows are written again
 * (`markRootRows`), their draw bins made for the new one. A transparent placement claims no
 * visibility row: its caster rows move with it, and its transparent corners are sent again. The
 * occlusion history of its rows is kept: a stale rectangle only moves a row between the two halves
 * of the partition, never a pixel (`../../../gpu/partition/projectWgsl.ts`). Returns the rows
 * written again.
 */
export function moveRootRows(rt: MovedRootTarget, root: ClusterRoot<PageRec>, rank: number) {
  if (rt.run) noteWorldMoved(rt.run, rank)
  noteRootWorld(rt, rank)
  if (root.pages[0]?.transparent) rt.blendState.occlusionEpoch = -1
  const cw = matrixWindingCw(root.world.elements)
  if (root.windingCw === cw) return 0
  root.windingEpoch = undefined
  return markRootRows(rt, root, 0, root.pages.length - 1)
}

/** A blended root's pages `from` to `to`, from packed rank `base`, bounded elsewhere: their own
 *  entries' transparent corners are sent again (`occlusionMoved`), every entry's without a table. */
function reboundCorners(rt: MovedRootTarget, base: number, from: number, to: number) {
  const { blendState } = rt,
    { table, occlusionMoved: moved } = blendState
  if (!table || !moved || base < 0) {
    blendState.occlusionEpoch = -1
    return
  }
  for (let page = from; page <= to; page++) {
    const entry = table.entryOf(base + page)
    if (entry < 0) continue
    extendSpan(moved, entry)
  }
}

/**
 * Declares the rows of `root`'s pages `from` to `to` dirty: their inputs, table words, draw bins and
 * every word the rows pass derives travel again for them alone, and a blended root's transparent
 * corners are sent again (`reboundCorners`). No pose moved here: a dynamic page's vertices lie in
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
  if (to >= from && root.pages[0]?.transparent) reboundCorners(rt, base, from, to)
  let rewritten = 0
  for (let page = from; page <= to; page++) {
    const index = base + page,
      transparent = !!root.pages[page].transparent
    // A blended cluster moves its caster row (`../../row/blendCasters.ts`), which is its own.
    const row = transparent ? rows.blendRowOf(index) : rows.rowOf(index)
    if (!rows.pageTableFloats || row < 0) continue
    // A row the cache gave back may name another page since: only a row that is this page's.
    if (!transparent && (row >= rows.packedCount || rows.packedPageIndex[row] !== index)) continue
    rows.markRowWords(row)
    rewritten++
  }
  return rewritten
}
