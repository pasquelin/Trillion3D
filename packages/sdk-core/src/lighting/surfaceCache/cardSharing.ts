import type { Card } from './cardTypes.ts'
import type { SpanArray } from './spanArray.ts'

/**
 * CARD SHARING: cards that look alike — the same mesh with the same materials, the same face, the same
 * proportions (`Card.sharingId`) — are captured once. A card that needs a surface looks for one of
 * its kind whose coarsest level is at least as fine as it needs, and the capture copies that
 * card's texels, mirrored if the placement of one turned the width round and not the other's.
 * Each card still keeps its own pages, and its own light.
 *
 * The cards of one kind are a list whose places are kept while others come and go, and a card's
 * place is `Card.sharingIndex`. The changes of an image are told at the end of the pass that
 * makes them, in the order of the sharing id, removals before additions of the same id, so that a
 * kind whose last card goes and whose first returns in one image keeps its list.
 */

/** A card of one kind that can be copied: its coarsest level, and whether its placement turned the
 *  width round. */
interface Sharer {
  readonly card: number
  readonly minResLevel: number
  readonly axisXFlipped: boolean
}

/** The cards of one kind: a list whose places are kept, the place freed last the first reused. */
function createSharerList() {
  const items: (Sharer | undefined)[] = []
  const freed: number[] = []
  let count = 0
  return {
    add(sharer: Sharer) {
      const at = freed.pop() ?? items.length
      items[at] = sharer
      count++
      return at
    },
    remove(at: number) {
      items[at] = undefined
      freed.push(at)
      count--
    },
    get empty() {
      return count === 0
    },
    /** The first in the list whose coarsest level is at least `resLevel`, if any. */
    find(resLevel: number) {
      for (const item of items) if (item !== undefined && resLevel <= item.minResLevel) return item
      return undefined
    },
  }
}

/** A card that left its list, or joined it, until the pass ends. */
interface Removal {
  readonly id: number
  readonly index: number
}
interface Addition extends Sharer {
  readonly id: number
}

/** The lists of cards that may copy one another, by sharing id. */
type SharerLists = Map<number, ReturnType<typeof createSharerList>>

const byRemoval = (a: Removal, b: Removal) => a.id - b.id || a.index - b.index
/** The card with the finest coarsest level comes first among those of a kind. */
const byAddition = (a: Addition, b: Addition) =>
  a.id - b.id || b.minResLevel - a.minResLevel || a.card - b.card

/**
 * Takes the changes of the pass into the lists, and empties `removals` and `additions`: one kind
 * at a time, in the order of the ids, its removals before its additions; a kind with no card left
 * is forgotten.
 */
function flushChanges(
  lists: SharerLists,
  removals: Removal[],
  additions: Addition[],
  cards: SpanArray<Card>,
) {
  removals.sort(byRemoval)
  additions.sort(byAddition)
  let r = 0,
    a = 0
  while (r < removals.length || a < additions.length) {
    const id = Math.min(
      r < removals.length ? removals[r].id : Infinity,
      a < additions.length ? additions[a].id : Infinity,
    )
    const list = lists.get(id) ?? createSharerList()
    while (r < removals.length && removals[r].id === id) list.remove(removals[r++].index)
    while (a < additions.length && additions[a].id === id) {
      const { card, minResLevel, axisXFlipped } = additions[a++]
      if (cards.has(card))
        cards.at(card).sharingIndex = list.add({ card, minResLevel, axisXFlipped })
    }
    if (list.empty) lists.delete(id)
    else lists.set(id, list)
  }
  removals.length = 0
  additions.length = 0
}

/** The lists of cards that may copy one another, and the changes waiting. */
export function createCardSharing() {
  const lists: SharerLists = new Map()
  const removals: Removal[] = []
  const additions: Addition[] = []
  return {
    /** A card of the kind `id` whose coarsest level is at least as fine as `resLevel`, if there is
     *  one (`id` -1 is none). */
    find(id: number, resLevel: number) {
      return id < 0 ? undefined : lists.get(id)?.find(resLevel)
    },
    /** The card `card` of the kind `id` has made its coarsest level `minResLevel`. */
    queueAddition(id: number, card: number, minResLevel: number, axisXFlipped: boolean) {
      additions.push({ id, card, minResLevel, axisXFlipped })
    },
    /** The card of the kind `id` at place `index` of its list lost its coarsest level. */
    queueRemoval(id: number, index: number) {
      removals.push({ id, index })
    },
    /** Takes the changes of the pass into the lists. */
    flush: (cards: SpanArray<Card>) => flushChanges(lists, removals, additions, cards),
    /** Forgets every list and every change waiting. */
    clear() {
      lists.clear()
      removals.length = 0
      additions.length = 0
    },
  }
}

/** The cards that may copy one another. */
export type CardSharing = ReturnType<typeof createCardSharing>
