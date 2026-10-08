import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import type { ClusterRoot } from '../../../page/selection/types.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import type { WebgpuPagesLayout } from '../prepare/layout.ts'
import { noteWorldMoved } from './movedWorlds.ts'

const ROW_WORDS = PAGE_INFO_STRIDE / 4

/** What a moved root rewrites: its rows and the memos its world feeds, and the runtime's list of
 *  moved placements, which names it (`movedWorlds.ts`). */
export type MovedRootTarget = {
  layout: Pick<WebgpuPagesLayout, 'rows'>
  run?: Parameters<typeof noteWorldMoved>[0]
  blendState: {
    occlusionEpoch: number
    occlusionMoved?: { from: number; to: number }
    table?: { readonly entryOfPage: Int32Array }
  }
}

/**
 * The world of one placement moved: only what reads it follows. Its resident rows get their world
 * matrix — the only words of a row a pose writes (`../../row/pageRowWriter.ts`) — and are declared dirty,
 * so the table, the corners, the draw items and the shadow spheres travel for them alone, and the
 * partition forgets their occlusion verdict (`../../visibility/corners.ts`) while the rest of the
 * scene keeps its own. Its windings are computed again. A transparent placement claims no visibility
 * row: its caster rows move, and the transparent corners are sent again. Placement `rank` is named
 * beside that write: its world alone goes up (`movedWorlds.ts`), and the GPU cut's tree fits again
 * the group of the pose its send says moved (`updateWorlds`). Returns the rows rewritten.
 *
 * The table's age does not move: it rewrote every row, every corner and every transparent corner,
 * and dropped the whole scene's occlusion history, each image a model moved.
 */
export function moveRootRows(rt: MovedRootTarget, root: ClusterRoot<PageRec>, rank: number) {
  root.windingEpoch = undefined
  if (rt.run) noteWorldMoved(rt.run, rank)
  return markRootRows(rt, root, 0, root.pages.length - 1, root.world.elements)
}

/** A blended root's pages `from` to `to`, from packed rank `base`, moved: a pose sends every
 *  transparent corner again; a page bounded elsewhere, its own entry's (`occlusionMoved`). */
function reboundCorners(
  rt: MovedRootTarget,
  base: number,
  from: number,
  to: number,
  pose: boolean,
) {
  const { blendState } = rt,
    { table, occlusionMoved: moved } = blendState
  if (pose || !table || !moved || base < 0) {
    blendState.occlusionEpoch = -1
    return
  }
  for (let page = from; page <= to; page++) {
    const entry = table.entryOfPage[base + page] ?? -1
    if (entry < 0) continue
    moved.from = Math.min(moved.from, entry)
    moved.to = Math.max(moved.to, entry)
  }
}

/**
 * Declares the rows of `root`'s pages `from` to `to` dirty, each given `world` first when one is
 * given: their table words, corners, shadow spheres and level-of-detail words travel again for them
 * alone, and a blended root's transparent corners are sent again (`reboundCorners`). Without a
 * `world`, the pages are
 * bounded elsewhere and no pose moved — a dynamic page's vertices lie in another box
 * (`PageRec.moved`), or its root holds another reach —: the windings keep.
 * Returns the rows marked.
 */
export function markRootRows(
  rt: MovedRootTarget,
  root: ClusterRoot<PageRec>,
  from: number,
  to: number,
  world?: ArrayLike<number>,
) {
  const { rows } = rt.layout,
    floats = rows.pageTableFloats,
    base = root.packedBase ?? -1
  if (to >= from && root.pages[0]?.transparent) reboundCorners(rt, base, from, to, !!world)
  let rewritten = 0
  for (let page = from; page <= to; page++) {
    const index = base + page,
      transparent = !!root.pages[page].transparent
    // A blended cluster moves its caster row (`../../row/blendCasters.ts`), which is its own.
    const row = transparent ? rows.blendRowOf[index] : rows.rowOfPage[index]
    if (!floats || row < 0) continue
    // A row the cache gave back may name another page since: only a row that is this page's.
    if (!transparent && (row >= rows.packedCount || rows.packedPageIndex[row] !== index)) continue
    if (world) floats.set(world, row * ROW_WORDS)
    rows.markRowWords(row)
    rewritten++
  }
  return rewritten
}
