import { CAND_WORDS, POST_WORDS, VISIBLE_WORDS } from './shader/listsWgsl.ts'
import { cutListCaps, type CutListCaps } from './lists/cutListCaps.ts'
import type { PackedDag } from './types.ts'
import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'

/**
 * THE CUT'S FLAGS, LAID OUT ONCE FOR ITS LISTS' CAPS (`lists/cutListCaps.ts`): its descent array,
 * its candidate clusters, the clusters it draws, its drawn log and the post pass's held items, each
 * section sized at its cap within
 * what the packing can ever hold, never grown on demand. A cut that passes a cap draws what fits and
 * says so (`lists/listFeedback.ts`); caps changed at run time lay the flags out again between two
 * frames (`queueGrowth.ts`).
 */

/** The entries queue 0 holds as a cut starts, one `dagPrepare` thread each: without a placement
 *  tree, every placement's root; with one, the tree's top nodes, then each member drawn whatever
 *  the view and each placement of the world DAG (`shader/placementTreeWgsl.ts`). */
export function queueZeroEntries(packed: Partial<Pick<PackedDag, 'worldCount' | 'placementTree'>>) {
  const tree = packed.placementTree
  if (!tree) return Math.max(1, packed.worldCount ?? 0)
  return tree.levels[0].count + tree.always.set.count
}

/** The entries a pass's descent array holds that no node budget bounds: queue 0's
 *  (`queueZeroEntries`), and with a placement tree each of its cells and each member a kept group
 *  deposits, once a pass at most (`shader/placementTreeWgsl.ts`). */
function instanceEntries(packed: Partial<Pick<PackedDag, 'worldCount' | 'placementTree'>>) {
  const tree = packed.placementTree,
    zero = queueZeroEntries(packed)
  if (!tree) return zero
  return zero + tree.levels.reduce((cells, level) => cells + level.count, 0) + tree.capacity
}

/** Flag sections behind the descent array: the candidates, the live list and the drawn log
 *  (`shader/listsWgsl.ts`, `shader/liveWgsl.ts`); the post pass's held items follow them. */
const LIST_SECTIONS = 3

/**
 * What a cut's `flags` is laid out for, and the budget its kernels hold one pass's nodes to: the
 * words of the descent array, two an entry, as many entries as the post pass's held items, three
 * words each; the candidate clusters' entries — the descent's, both passes', and from the list's
 * end those the previous image's pyramid hid, the one budget all of them share —; the entries of
 * the live list and of the drawn log; and the nodes one pass opens (`shader/levelWgsl.ts`).
 */
export type FlagShape = { queueWords: number; candCap: number; visCap: number; nodeBudget: number }

/** The lists behind the descent array, where each starts, in words of a candidate entry then of a
 *  visible one (`shader/listsWgsl.ts`): the candidates; the live list behind them; the drawn log
 *  behind it. */
const LIST_STARTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [CAND_WORDS, 0],
  [CAND_WORDS, 2],
]

/** First word of section `s` of a `flags` of `shape`: the kernel's list bases — the descent array,
 *  the three lists, then the post pass's held items (`postNodeBase`). */
export function flagSectionStart(s: number, { queueWords, candCap, visCap }: FlagShape) {
  if (s === 0) return 0
  if (s <= LIST_SECTIONS) {
    const [cand, visible] = LIST_STARTS[s - 1]
    return queueWords + cand * candCap + visible * visCap
  }
  return queueWords + CAND_WORDS * candCap + VISIBLE_WORDS * visCap
}

/** The section a cut keeps from one cut to the next: the drawn log of the last cut committed
 *  (`shader/commitWgsl.ts`). The others each cut writes before it reads them. */
export const JOURNAL_SECTION = 3

/** The words of the sections of a `flags` of `shape`: the descent array, `queueWords`, and as many
 *  held items, `POST_WORDS` each; the candidates, `candCap` entries; the live list and the drawn
 *  log, `visCap` entries each. */
export const flagShapeWords = ({ queueWords, candCap, visCap }: FlagShape) =>
  queueWords + (queueWords / 2) * POST_WORDS + CAND_WORDS * candCap + VISIBLE_WORDS * visCap

/**
 * The shape of `packed`'s flags for the lists' `caps`, each section at its cap within what the
 * packing can ever hold — a pure saving, no cut asks past it: a pass opens each placement's node
 * once at most (`PackedDag.entryCount`), the descent array holding them beside the entries no
 * budget bounds (`instanceEntries`); a cut lists each page once a pass and holds back for the post
 * pass only pages it listed, so its candidates never pass twice its pages, and it draws each page
 * once. The flags are a record table (`cut/cutTables.ts`): no section is held to a binding.
 */
export function dagFlagShape(
  packed: Pick<PackedDag, 'pageCount'> &
    Partial<Pick<PackedDag, 'entryCount' | 'nodeCount' | 'worldCount' | 'placementTree'>>,
  caps: CutListCaps = cutListCaps(),
): FlagShape {
  const pages = Math.max(1, packed.pageCount),
    nodeBudget = clamp(packed.entryCount ?? packed.nodeCount ?? 0, 1, caps.nodes)
  return {
    queueWords: 2 * (nodeBudget + instanceEntries(packed)),
    candCap: clampLowWins(2 * pages, 1, caps.candidates),
    visCap: clampLowWins(pages, 1, caps.visible),
    nodeBudget,
  }
}

/** Whether two shapes lay the flags out alike and hold the same budget. */
export const sameFlagShape = (a: FlagShape, b: FlagShape) =>
  a.queueWords === b.queueWords &&
  a.candCap === b.candCap &&
  a.visCap === b.visCap &&
  a.nodeBudget === b.nodeBudget
