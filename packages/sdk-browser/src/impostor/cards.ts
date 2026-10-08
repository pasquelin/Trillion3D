/**
 * THE IMAGE'S IMPOSTOR CARDS (#1335, #1336), kept from one image to the next: the switch of every
 * root followed by a watch (`createImpostorWatch`) at the engine's focal length, each root whose
 * verdict moved taking or giving back its card, each card a record written once (`cardSlots.ts`),
 * grouped by mesh into runs that share an atlas. A run's atlas is bound as a bind group
 * (`webgpu/impostor/`): `G` is that binding, and `atlasOf` answers it once the mesh's atlas is
 * resident — asking it otherwise. The GPU turns each card to the camera and takes the eye off it
 * every image (`webgpu/impostor/cardWgsl.ts`): the CPU writes nothing for a card that stays.
 *
 * Cost per image: O(V + M + C) for V roots the watch reads again (`watch.ts`), M meshes with a
 * switched root, C cards whose root switched or moved; zero records for a still view.
 */
import {
  frustumExcludesBox,
  type ImpostorMaps,
  type ImpostorSection,
} from '../../../sdk-core/src/index.ts'
import { createImpostorWatch, impostorViewCosine } from '../../../sdk-core/src/impostor/watch.ts'
import { bakedLookup } from '../../../sdk-core/src/impostor/switchTable.ts'
import { transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { boxEmpty, boxUnion } from '../../../math/src/geometry/box.ts'
import { core } from './borrowed.ts'
import {
  createCardSlots,
  freeSlot,
  slotAtEnd,
  writeCardRecord,
  type CardHolder,
  type CardSegment,
} from './cardSlots.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { ClusterRoot } from '../page/selection/types.ts'

/**
 * Coverage below which a card texel is no surface: the engine's default alpha cutoff, the one a
 * masked material without its own declares (`MASK_CUTOFF`, the world API's: not imported into the
 * shader layer). The bake stores coverage, never a cut, so the cut is the runtime's; a mesh whose
 * material declares another keeps it on its own clusters.
 */
export const CARD_COVERAGE_CUT = 0.5

/** One run of cards that share a mesh's atlas: one bind and one instanced draw. */
type CardRun<G> = { group: G; first: number; count: number }

/** What a session's cards are told and ask, given once: the group of a mesh's atlas, asked while
 *  absent; each root whose card bit moved; whether a root may take a card at all — one another
 *  structure draws far away takes none. */
export type CardHooks<G> = {
  atlasOf: (mesh: number, maps: ImpostorMaps) => G | undefined
  moved?: CardMoved
  carded?: (rank: number) => boolean
}

/** No root list planned yet, or one dropped. */
const NO_ROOTS: readonly ClusterRoot<unknown>[] = []

/** A session's cards: the baked meshes, the watch over the switch, the records and their segments,
 *  and this image's runs. */
export function createImpostorCards<G>(section: ImpostorSection, hooks: CardHooks<G>) {
  return {
    section,
    hooks,
    baked: bakedLookup(section),
    watch: createImpostorWatch(),
    slots: createCardSlots(),
    segments: new Map<number, CardSegment<G>>(),
    /** Per root: the card it holds. */
    holding: [] as (CardHolder | undefined)[],
    /** Roots whose world moved since the last image (`worldsMoved`), each once. */
    moves: core.createDenseKeySet(),
    /** The root list the cards were planned over; none before the first plan or after a drop. */
    roots: NO_ROOTS,
    /** This image's runs, `runs[0 .. runCount)`, and the cards they draw. */
    runs: [] as CardRun<G>[],
    runCount: 0,
    count: 0,
  }
}

export type ImpostorCards<G> = ReturnType<typeof createImpostorCards<G>>
/** Told of each root whose card bit moved: the GPU cut's copy of the mark follows it. */
type CardMoved = (rank: number, root: ClusterRoot<unknown>) => void

/** The roots `ranks` moved: their switch read again and their cards written. */
export function impostorWorldsMoved<G>(state: ImpostorCards<G>, ranks: ArrayLike<number>) {
  for (let i = 0; i < ranks.length; i++) {
    state.moves.add(ranks[i])
    state.watch.touch(ranks[i])
  }
}

/** Bytes of the tier's host tables: the watch's (`hostBytes`), the card records and the slots to
 *  send, the card each root holds and the roots that moved, and each mesh's roots switched and
 *  cards. */
export function impostorCardsBytes<G>(state: ImpostorCards<G>) {
  const { slots } = state
  let segments = 0
  for (const segment of state.segments.values())
    segments += segment.eligible.byteLength + 8 * segment.cards.length
  return (
    state.watch.hostBytes +
    slots.records.byteLength +
    slots.dirty.listed.byteLength +
    slots.dirty.sorted.byteLength +
    8 * state.holding.length +
    state.moves.byteLength +
    segments
  )
}

/** A tier turned off (its path's drop), or a new root list: no card, and every root the cards
 *  were planned over its clusters again. */
export function dropImpostorCards<G>(state: ImpostorCards<G> | undefined) {
  if (!state || state.roots === NO_ROOTS) return
  for (const segment of state.segments.values()) {
    const { list, count } = segment.eligible
    for (let i = 0; i < count; i++) mark(state, list[i], false)
  }
  Object.assign(state, createImpostorCards<G>(state.section, state.hooks))
}

const pivot = new Float64Array(3),
  ORIGIN = [0, 0, 0] as const

/** Root `rank`'s card bit set or cleared, the GPU cut told when it moved (`moved`). */
function mark<G>(state: ImpostorCards<G>, rank: number, card: boolean) {
  const root = state.roots[rank]
  if (core.markCard(root, card)) state.hooks.moved?.(rank, root)
}

/**
 * THE IMAGE'S IMPOSTOR PLAN: the switch of `roots` at the engine's focal length for `viewport`,
 * read again where the view may have moved it (`createImpostorWatch`). A root whose switch holds
 * draws its card once its mesh's atlas is resident (`atlasOf`), asked while one of the mesh's
 * switched roots may be in view: a mesh asked in view and still streaming leaves its roots to their
 * clusters, so the switch never opens a hole; one never asked in view leaves them to the card,
 * which draws nothing there either way. The verdict marks each root (`CARD_ROOT`): every camera cut
 * leaves a marked root to its card, every light cut keeps its clusters, so the object casts its
 * mesh's shadow.
 */
export function planImpostorCards<G>(
  state: ImpostorCards<G>,
  roots: readonly ClusterRoot<unknown>[],
  cam: EngineCamera,
  viewport: readonly number[] | undefined,
) {
  const focal = core.focalPixels(cam.projection, viewport?.[0], viewport?.[1])
  // Another root list: the old one's cards dropped, their bits cleared, every root read again.
  if (state.roots !== roots) dropImpostorCards(state)
  state.roots = roots
  if (state.holding.length < roots.length) state.holding.length = roots.length
  const { watch } = state,
    cos = impostorViewCosine(cam.projection)
  watch.update(roots, state.section, cam.view, focal, cos, state.hooks.carded)
  for (let i = 0; i < watch.changedCount; i++) {
    const rank = watch.changed[i]
    if (watch.switched[rank]) enlist(state, rank)
    else delist(state, rank)
  }
  followMoves(state)
  drawable(state, cam)
}

/** The segment of `mesh`, made as its first root switches. */
function segmentOf<G>(state: ImpostorCards<G>, mesh: number): CardSegment<G> {
  let segment = state.segments.get(mesh)
  if (!segment) {
    segment = {
      mesh,
      entry: state.baked.get(mesh)!,
      ...{ start: state.slots.used, capacity: 0, count: 0, cards: [], holders: new Map() },
      ...{ eligible: core.createDenseKeySet(), box: new Float64Array(6), stale: false },
      ...{ group: undefined, gated: false, pending: [] },
    }
    boxEmpty(segment.box, 0)
    state.segments.set(mesh, segment)
  }
  return segment
}

/** Root `rank`'s pivot sphere joined to its segment's box. */
function grow<G>(state: ImpostorCards<G>, segment: CardSegment<G>, rank: number) {
  const centre = segment.entry.centre ?? ORIGIN,
    radius = state.watch.radiusOf(rank)
  transformAffinePoint(pivot, state.roots[rank].world.elements, centre[0], centre[1], centre[2])
  const [x, y, z] = pivot
  boxUnion(segment.box, 0, x - radius, y - radius, z - radius, x + radius, y + radius, z + radius)
}

/** The segment's box fitted again to the roots switched: one left or moved since. */
function refit<G>(state: ImpostorCards<G>, segment: CardSegment<G>) {
  segment.stale = false
  boxEmpty(segment.box, 0)
  const { list, count } = segment.eligible
  for (let i = 0; i < count; i++) grow(state, segment, list[i])
}

/** Root `rank`'s switch now holds: listed with its mesh, its card taken unless the mesh waits. */
function enlist<G>(state: ImpostorCards<G>, rank: number) {
  const { roots } = state,
    segment = segmentOf(state, roots[rank].mesh!)
  segment.eligible.add(rank)
  grow(state, segment, rank)
  if (segment.gated) return
  // With its atlas, the card at once; without, the image's view of the mesh decides (`drawable`).
  if (segment.group === undefined) return void segment.pending.push(rank)
  mark(state, rank, true)
  takeCard(state, segment, rank)
}

/** Root `rank`'s switch no longer holds: its card given back, its clusters drawn again. */
function delist<G>(state: ImpostorCards<G>, rank: number) {
  const { roots } = state,
    segment = state.segments.get(roots[rank].mesh!)
  if (!segment?.eligible.remove(rank)) return
  segment.stale = true
  mark(state, rank, false)
  giveCard(state, segment, rank)
}

/** Root `rank`'s card: the record of its world, shared with a root of its mesh placed by the same
 *  world — two primitives of one placement are one card —, read from the root as it is written. */
function takeCard<G>(state: ImpostorCards<G>, segment: CardSegment<G>, rank: number) {
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
  writeCardRecord(state.slots, slot, world, segment.entry, radius)
}

function giveCard<G>(state: ImpostorCards<G>, segment: CardSegment<G>, rank: number) {
  const card = state.holding[rank]
  if (!card) return
  state.holding[rank] = undefined
  if (--card.roots) return
  segment.holders.delete(card.world)
  freeSlot(state.slots, segment, card)
}

/** Root `rank` moved: its segment's box fitted again before the next view test, its card written
 *  from the root's world as it now is — a world remade elsewhere, the card's key follows it. */
function follow<G>(state: ImpostorCards<G>, rank: number) {
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
    segment.entry,
    state.watch.radiusOf(rank),
    true,
  )
}

/** The roots that moved since the last image (`impostorWorldsMoved`). */
function followMoves<G>(state: ImpostorCards<G>) {
  const { list, count } = state.moves
  for (let i = 0; i < count; i++) follow(state, list[i])
  state.moves.clear()
}

/** Each mesh with a switched root whose box the view holds: its atlas asked, its cards taken as it
 *  lands or given back as it leaves, and its run drawn. A mesh out of view leaves the roots that
 *  switched to their card, which draws nothing there either way, until the view asks its atlas. */
function drawable<G>(state: ImpostorCards<G>, cam: EngineCamera) {
  state.runCount = state.count = 0
  for (const segment of state.segments.values()) {
    const pending = segment.pending
    if (!segment.eligible.count) {
      pending.length = 0
      continue
    }
    if (segment.stale) refit(state, segment)
    const box = segment.box
    if (frustumExcludesBox(cam.planes, box[0], box[1], box[2], box[3], box[4], box[5])) {
      if (!segment.gated) for (const rank of pending) cardAt(state, segment, rank, true)
      pending.length = 0
      continue
    }
    pending.length = 0
    const group = state.hooks.atlasOf(segment.mesh, segment.entry.maps),
      held = segment.group !== undefined && !segment.gated,
      gated = segment.gated
    segment.group = group
    segment.gated = group === undefined
    // In view without its atlas, its roots keep their clusters until it lands; as it lands, each
    // takes its card.
    if (group === undefined ? !gated : !held) {
      const { list, count } = segment.eligible
      for (let i = 0; i < count; i++) cardAt(state, segment, list[i], group !== undefined)
    }
    if (group === undefined || !segment.count) continue
    const run = (state.runs[state.runCount++] ??= { group, first: 0, count: 0 })
    run.group = group
    run.first = segment.start
    run.count = segment.count
    state.count += segment.count
  }
}

/** Root `rank`'s card bit set or cleared, its card taken when its mesh's atlas is held. */
function cardAt<G>(state: ImpostorCards<G>, segment: CardSegment<G>, rank: number, card: boolean) {
  if (!segment.eligible.has(rank)) return
  mark(state, rank, card)
  if (!card) giveCard(state, segment, rank)
  else if (segment.group !== undefined) takeCard(state, segment, rank)
}
