/**
 * THE IMAGE'S IMPOSTOR CARDS (#1335, #1336), kept from one image to the next: the switch of every
 * root followed by a watch (`createImpostorWatch`) at the engine's focal length, each root whose
 * verdict moved taking or giving back its card, each card a record written once (`cardSlots.ts`),
 * grouped by mesh into runs. A mesh's maps are textures of the one tile pool (`CardTiles`): its
 * cards are drawn once `ready` says every tile they read resides — asking the missing ones
 * otherwise —, each record naming the three maps. The GPU turns each card to the camera and takes
 * the eye off it every image (`webgpu/impostor/cardWgsl.ts`): the CPU writes nothing for a card
 * that stays.
 *
 * Cost per image: O(V + M + C) for V roots the watch reads again (`watch.ts`), M meshes with a
 * switched root — each asking its maps once (`cardAsk.ts`) —, C cards whose root switched or
 * moved; zero records for a still view.
 */
import type { ImpostorSection } from '../../../sdk-core/src/contracts/impostor.ts'
import { createImpostorWatch, impostorViewCosine } from '../../../sdk-core/src/impostor/watch.ts'
import { bakedLookup } from '../../../sdk-core/src/impostor/switchTable.ts'
import { core } from './borrowed.ts'
import { createCardSlots, type CardHolder, type CardSegment } from './cardSlots.ts'
import { followMoves, giveCard, mark, takeCard } from './cardHolders.ts'
import { grow, segmentOf } from './cardSegment.ts'
import { drawable } from './cardsView.ts'
import type { CardAsk, CardHold, CardTiles } from '../webgpu/tile/cardTiles.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { ClusterRoot } from '../page/selection/types.ts'

/**
 * Coverage below which a card texel is no surface: the engine's default alpha cutoff, the one a
 * masked material without its own declares (`MASK_CUTOFF`, the world API's: not imported into the
 * shader layer). The bake stores coverage, never a cut, so the cut is the runtime's; a mesh whose
 * material declares another keeps it on its own clusters.
 */
export const CARD_COVERAGE_CUT = 0.5

/** One run of a mesh's cards: one instanced draw. */
type CardRun = { first: number; count: number }

/** What a session's cards are told and ask, given once: a mesh's three map slots in the tile
 *  atlases, none for one they do not hold; whether the maps hold every tile its cards read at
 *  `ask`, held by `hold`, the missing ones asked; a hold let go; each root whose card bit moved;
 *  whether a root may take a card at all — one another structure draws far away takes none. */
export type CardHooks = {
  tilesOf: (mesh: number) => CardTiles | undefined
  ready: (tiles: CardTiles, ask: CardAsk, hold: CardHold) => boolean
  release: (hold: CardHold) => void
  moved?: CardMoved
  carded?: (rank: number) => boolean
}

/** No root list planned yet, or one dropped. */
const NO_ROOTS: readonly ClusterRoot<unknown>[] = []

/** A session's cards: the baked meshes, the watch over the switch, the records and their segments,
 *  and this image's runs. */
export function createImpostorCards(section: ImpostorSection, hooks: CardHooks) {
  return {
    section,
    hooks,
    baked: bakedLookup(section),
    watch: createImpostorWatch(),
    slots: createCardSlots(),
    segments: new Map<number, CardSegment>(),
    /** Per root: the card it holds. */
    holding: [] as (CardHolder | undefined)[],
    /** Roots whose world moved since the last image (`worldsMoved`), each once. */
    moves: core.createDenseKeySet(),
    /** The root list the cards were planned over; none before the first plan or after a drop. */
    roots: NO_ROOTS,
    /** This image's runs, `runs[0 .. runCount)`, and the cards they draw. */
    runs: [] as CardRun[],
    runCount: 0,
    count: 0,
  }
}

export type ImpostorCards = ReturnType<typeof createImpostorCards>
/** Told of each root whose card bit moved: the GPU cut's copy of the mark follows it. */
type CardMoved = (rank: number, root: ClusterRoot<unknown>) => void

/** The roots `ranks` moved: their switch read again and their cards written. */
export function impostorWorldsMoved(state: ImpostorCards, ranks: ArrayLike<number>) {
  for (let i = 0; i < ranks.length; i++) {
    state.moves.add(ranks[i])
    state.watch.touch(ranks[i])
  }
}

/** Bytes of one card (`CardHolder`): an object of three fields, its header and its fields a word
 *  each; and of its entry in its mesh's card of each world, a key, a value and a link of the
 *  map's table and its bucket. */
const CARD_HOLDER_BYTES = 6 * 4,
  HOLDER_ENTRY_BYTES = 4 * 4

/** Bytes of the tier's host tables: the watch's (`hostBytes`), the card records and the slots to
 *  send, the card each root holds and the roots that moved, and each mesh's roots switched, cards
 *  and their objects and entries. */
export function impostorCardsBytes(state: ImpostorCards) {
  const { slots } = state
  let segments = 0
  for (const segment of state.segments.values())
    segments +=
      segment.eligible.byteLength +
      8 * segment.cards.length +
      segment.holders.size * (CARD_HOLDER_BYTES + HOLDER_ENTRY_BYTES)
  return (
    state.watch.hostBytes +
    slots.records.byteLength +
    slots.dirty.byteLength +
    8 * state.holding.length +
    state.moves.byteLength +
    segments
  )
}

/** A tier turned off (its path's drop), or a new root list: no card, and every root the cards
 *  were planned over its clusters again. */
export function dropImpostorCards(state: ImpostorCards | undefined) {
  if (!state || state.roots === NO_ROOTS) return
  for (const segment of state.segments.values()) {
    state.hooks.release(segment.hold)
    const { list, count } = segment.eligible
    for (let i = 0; i < count; i++) mark(state, list[i], false)
  }
  Object.assign(state, createImpostorCards(state.section, state.hooks))
}

/**
 * THE IMAGE'S IMPOSTOR PLAN: the switch of `roots` at the engine's focal length for `viewport`,
 * read again where the view may have moved it (`createImpostorWatch`). A root whose switch holds
 * draws its card once its mesh's maps hold every tile its cards read (`ready`), asked while one of
 * the mesh's switched roots may be in view: a mesh asked in view and still streaming leaves its
 * roots to their clusters, so the switch never opens a hole nor shows a coarser card; one never
 * asked in view leaves them to the card, which draws nothing there either way. The verdict marks
 * each root (`CARD_ROOT`): every camera cut leaves a marked root to its card, every light cut keeps
 * its clusters, so the object casts its mesh's shadow.
 */
export function planImpostorCards(
  state: ImpostorCards,
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
  drawable(state, cam, focal)
}

/** Root `rank`'s switch now holds: listed with its mesh, its card taken unless the mesh waits. */
function enlist(state: ImpostorCards, rank: number) {
  const { roots } = state,
    segment = segmentOf(state, roots[rank].mesh!)
  segment.eligible.add(rank)
  grow(state, segment, rank)
  if (segment.gated) return
  // Its maps ready, the card at once; else the image's view of the mesh decides (`drawable`).
  if (!segment.ready) return void segment.pending.push(rank)
  mark(state, rank, true)
  takeCard(state, segment, rank)
}

/** Root `rank`'s switch no longer holds: its card given back, its clusters drawn again. */
function delist(state: ImpostorCards, rank: number) {
  const { roots } = state,
    segment = state.segments.get(roots[rank].mesh!)
  if (!segment?.eligible.remove(rank)) return
  segment.stale = true
  mark(state, rank, false)
  giveCard(state, segment, rank)
}
