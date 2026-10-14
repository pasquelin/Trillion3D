import { core } from './borrowed.ts'
import {
  freeSlot,
  slotAtEnd,
  writeCardRecord,
  type CardHolder,
  type CardSegment,
} from './cardSlots.ts'
import type { ImpostorCards } from './cards.ts'

// The cards the roots hold (`cards.ts`): a root's card bit, the record of its world taken, given
// back and followed as the world moves.

/** Root `rank`'s card bit set or cleared, the GPU cut told when it moved (`moved`). */
export function mark(state: ImpostorCards, rank: number, card: boolean) {
  const root = state.roots[rank]
  if (core.markCard(root, card)) state.hooks.moved?.(rank, root)
}

/** Root `rank`'s card: the record of its world, shared with a root of its mesh placed by the same
 *  world — two primitives of one placement are one card —, read from the root as it is written. */
export function takeCard(state: ImpostorCards, segment: CardSegment, rank: number) {
  const world = state.roots[rank].world.elements,
    radius = state.watch.radiusOf(rank)
  // A radius the switch has not taken yet draws no card: the root keeps its clusters.
  if (!(radius > 0)) return mark(state, rank, false)
  if (state.holding[rank]) return
  const held = segment.holders.get(world)
  if (held) {
    held.roots++
    state.holding[rank] = held
    return
  }
  const slot = slotAtEnd(state.slots, state.segments.values(), segment),
    card: CardHolder = { slot: segment.count, world, roots: 1 }
  segment.holders.set(world, card)
  segment.cards[segment.count++] = card
  state.holding[rank] = card
  writeCardRecord(state.slots, slot, world, mapsOf(segment), radius)
}

/** What a record of `segment` names of its mesh: its entry and its maps, ready when it holds a
 *  card. */
const mapsOf = (segment: CardSegment) => ({ entry: segment.entry, tiles: segment.tiles! })

export function giveCard(state: ImpostorCards, segment: CardSegment, rank: number) {
  const card = state.holding[rank]
  if (!card) return
  state.holding[rank] = undefined
  if (--card.roots) return
  segment.holders.delete(card.world)
  freeSlot(state.slots, segment, card)
}

/** Root `rank` moved: its segment's box fitted again before the next view test, its card written
 *  from the root's world as it now is — a world remade elsewhere, the card's key follows it. */
function follow(state: ImpostorCards, rank: number) {
  const { roots } = state
  if (rank >= roots.length) return
  const segment = state.segments.get(roots[rank].mesh!)
  if (!segment?.eligible.has(rank)) return
  segment.stale = true
  const card = state.holding[rank]
  if (!card) return
  const world = roots[rank].world.elements
  if (card.world !== world) {
    if (segment.holders.get(card.world) === card) segment.holders.delete(card.world)
    card.world = world
    segment.holders.set(world, card)
  }
  writeCardRecord(
    state.slots,
    segment.start + card.slot,
    world,
    mapsOf(segment),
    state.watch.radiusOf(rank),
    true,
  )
}

/** The roots that moved since the last image (`impostorWorldsMoved`). */
export function followMoves(state: ImpostorCards) {
  const { list, count } = state.moves
  for (let i = 0; i < count; i++) follow(state, list[i])
  state.moves.clear()
}
