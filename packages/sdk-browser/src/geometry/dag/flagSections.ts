import { cutListCaps, type CutListCaps } from './lists/cutListCaps.ts'
import type { PackedDag } from './types.ts'
import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'

/**
 * THE CUT'S FLAGS, LAID OUT ONCE FOR ITS LISTS' CAPS (`lists/cutListCaps.ts`): its descent array,
 * its candidate clusters and the post pass's held items, each section sized at its cap within
 * what the packing can ever hold, never grown on demand. A cut that passes a cap draws what fits and
 * says so (`lists/listFeedback.ts`); caps changed at run time lay the flags out again between two
 * frames (`queueGrowth.ts`). The clusters the cut draws are not among them: they lie in the list of
 * visible clusters (`visible/layout.ts`), whose room follows what the cut asks of it
 * (`visible/visibleGrowth.ts`).
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
export function instanceEntries(packed: Partial<Pick<PackedDag, 'worldCount' | 'placementTree'>>) {
  const tree = packed.placementTree,
    zero = queueZeroEntries(packed)
  if (!tree) return zero
  return zero + tree.levels.reduce((cells, level) => cells + level.count, 0) + tree.capacity
}

/**
 * What a cut's `flags` is laid out for, and the budget its kernels hold one pass's nodes to: the
 * words of the descent array, two an entry, as many entries as the post pass's held items, three
 * words each; the candidate clusters' entries — the descent's, both passes', and from the list's
 * end those the previous image's pyramid hid, the one budget all of them share —; and the nodes one
 * pass opens (`shader/levelWgsl.ts`).
 */
export type FlagShape = { queueWords: number; candCap: number; nodeBudget: number }

/** Words of a candidate entry — the page, its placement —, the descent's or one the previous
 *  pyramid hid, `candCap` of them. */
export const CAND_WORDS = 2
/** Words of an item the previous pyramid hid (`postNode`): the first item, its placement, and the
 *  mask of the items held from it — a node's children, as their parent holds them. */
export const POST_WORDS = 3

/** A section of the flags: its words in a flags of a shape, and the same count as the kernel spells
 *  it on the cut's uniform block, where a section follows it to start behind it. */
type FlagSection = { words: (shape: FlagShape) => number; wgsl?: string }

/** The sections of the flags in order — the descent array, `queueWords`; the candidates, `candCap`
 *  entries; as many held items, `POST_WORDS` each, as the descent array holds entries —: the one
 *  table the host reads (`flagSectionStart`, `flagShapeWords`) and the kernel's list bases are
 *  written from (`flagSectionStartExpression`). */
const FLAG_SECTIONS: readonly FlagSection[] = [
  { words: ({ queueWords }) => queueWords, wgsl: 'cutView.queueCap' },
  { words: ({ candCap }) => CAND_WORDS * candCap, wgsl: `${CAND_WORDS}u*cutView.candCap` },
  { words: ({ queueWords }) => (queueWords / 2) * POST_WORDS },
]

/** First word of section `s` of a `flags` of `shape`: the kernel's list bases — the descent array,
 *  the candidates, then the post pass's held items (`candBase`, `postNodeBase`). */
export const flagSectionStart = (s: number, shape: FlagShape) =>
  FLAG_SECTIONS.slice(0, s).reduce((start, section) => start + section.words(shape), 0)

/** The first word of section `s` as the kernel computes it: the words of the sections before it. */
export const flagSectionStartExpression = (s: number) =>
  FLAG_SECTIONS.slice(0, s)
    .flatMap(({ wgsl }) => wgsl ?? [])
    .join('+')

/** The words of the sections of a `flags` of `shape`. */
export const flagShapeWords = (shape: FlagShape) => flagSectionStart(FLAG_SECTIONS.length, shape)

/**
 * The shape of `packed`'s flags for the lists' `caps`, each section at its cap within what the
 * packing can ever hold — a pure saving, no cut asks past it: a pass opens each placement's node
 * once at most (`PackedDag.entryCount`), the descent array holding them beside the entries no
 * budget bounds (`instanceEntries`); a cut lists each page once a pass and holds back for the post
 * pass only pages it listed, so its candidates never pass twice its pages. The flags are a record
 * table (`cut/cutTables.ts`): no section is held to a binding.
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
    nodeBudget,
  }
}

/** Whether two shapes lay the flags out alike and hold the same budget. */
export const sameFlagShape = (a: FlagShape, b: FlagShape) =>
  a.queueWords === b.queueWords && a.candCap === b.candCap && a.nodeBudget === b.nodeBudget
