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
  impostorBakedByMesh,
  type ImpostorMaps,
  type ImpostorSection,
} from '../../../sdk-core/src/index.ts'
import { createImpostorWatch, impostorViewCosine } from '../../../sdk-core/src/impostor/watch.ts'
import { transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { core } from './borrowed.ts'
import {
  createCardSlots,
  freeSlot,
  slotAtEnd,
  writeCardRecord,
  type CardSegment,
} from './cardSlots.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { ClusterRoot } from '../page/selection/types.ts'

export { CARD_FLOATS } from './cardSlots.ts'

/**
 * Coverage below which a card texel is no surface: the engine's default alpha cutoff, the one a
 * masked material without its own declares (`MASK_CUTOFF`, the world API's: not imported into the
 * shader layer). The bake stores coverage, never a cut, so the cut is the runtime's; a mesh whose
 * material declares another keeps it on its own clusters.
 */
export const CARD_COVERAGE_CUT = 0.5

/** One run of cards that share a mesh's atlas: one bind and one instanced draw. */
type CardRun<G> = { group: G; first: number; count: number }

/** A session's cards: the baked meshes, the watch over the switch, the records and their segments,
 *  and this image's runs. */
export function createImpostorCards<G>(section: ImpostorSection) {
  return {
    section,
    baked: impostorBakedByMesh(section),
    watch: createImpostorWatch(),
    slots: createCardSlots(),
    segments: new Map<number, CardSegment<G>>(),
    /** Per root: its place among its mesh's switched roots, or -1; the world its card holds. */
    eligibleAt: new Int32Array(0),
    cardOf: [] as (ArrayLike<number> | undefined)[],
    /** Roots whose world moved since the last image (`worldsMoved`); all of them when `allMoved`. */
    moves: [] as number[],
    allMoved: false,
    /** Whether the tier planned since it was made or dropped, and the root list it planned. */
    live: false,
    roots: undefined as readonly ClusterRoot<unknown>[] | undefined,
    /** This image's runs, `runs[0 .. runCount)`, and the cards they draw. */
    runs: [] as CardRun<G>[],
    runCount: 0,
    count: 0,
  }
}

export type ImpostorCards<G> = ReturnType<typeof createImpostorCards<G>>
/** Told of each root whose card bit moved: the GPU cut's copy of the mark follows it. */
export type CardMoved = (rank: number, root: ClusterRoot<unknown>) => void

/** The roots `ranks` moved, or every root: their switch read again and their cards written. */
export function impostorWorldsMoved<G>(state: ImpostorCards<G>, ranks?: ArrayLike<number>) {
  if (!ranks) return void (state.allMoved = true)
  for (let i = 0; i < ranks.length; i++) {
    state.moves.push(ranks[i])
    state.watch.touch(ranks[i])
  }
}

/** A tier turned off (its path's drop): no card, and every root its clusters again. */
export function dropImpostorCards<G>(
  state: ImpostorCards<G> | undefined,
  roots: readonly ClusterRoot<unknown>[],
  moved?: CardMoved,
) {
  if (!state?.live) return
  for (const segment of state.segments.values())
    for (let i = 0; i < segment.eligibleCount; i++) mark(roots, segment.eligible[i], false, moved)
  Object.assign(state, createImpostorCards<G>(state.section))
}

const pixelScale = [0, 0],
  pivot = new Float64Array(3),
  ORIGIN = [0, 0, 0] as const

const mark = (
  roots: readonly ClusterRoot<unknown>[],
  rank: number,
  card: boolean,
  moved?: CardMoved,
) => {
  if (core.markCard(roots[rank], card)) moved?.(rank, roots[rank])
}

/** What one image's plan reads. */
type Image<G> = {
  state: ImpostorCards<G>
  roots: readonly ClusterRoot<unknown>[]
  moved?: CardMoved
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
  atlasOf: (mesh: number, maps: ImpostorMaps) => G | undefined,
  moved?: CardMoved,
  /** Whether a root may take a card: one another structure draws far away takes none. */
  carded?: (rank: number) => boolean,
) {
  core.pixelScaleOf(cam.projection, viewport, pixelScale)
  const focal = Math.max(pixelScale[0], pixelScale[1]),
    image: Image<G> = { state, roots, moved }
  // Another root list: the old one's cards dropped, their bits cleared, every root read again.
  if (state.roots && state.roots !== roots) dropImpostorCards(state, state.roots, moved)
  state.roots = roots
  if (state.eligibleAt.length !== roots.length) fitRoots(state, roots.length)
  if (state.allMoved) state.watch.touchAll()
  const { watch } = state
  watch.update(roots, state.section, cam.view, focal, impostorViewCosine(cam.projection), carded)
  state.live = true
  for (let i = 0; i < watch.changedCount; i++) {
    const rank = watch.changed[i]
    if (watch.switched[rank]) enlist(image, rank)
    else delist(image, rank)
  }
  followMoves(image)
  drawable(image, cam, atlasOf)
}

/** The per-root tables at `n` roots, each switched root's place kept. */
function fitRoots<G>(state: ImpostorCards<G>, n: number) {
  const next = new Int32Array(n).fill(-1)
  next.set(state.eligibleAt.subarray(0, Math.min(n, state.eligibleAt.length)))
  state.eligibleAt = next
  state.cardOf.length = n
}

/** The segment of `mesh`, made as its first root switches. */
function segmentOf<G>(state: ImpostorCards<G>, mesh: number): CardSegment<G> {
  let segment = state.segments.get(mesh)
  if (!segment) {
    segment = {
      mesh,
      entry: state.baked.get(mesh)!,
      ...{ start: state.slots.used, capacity: 0, count: 0, worlds: [], holders: new Map() },
      ...{ eligible: new Int32Array(4), eligibleCount: 0, box: new Float64Array(6) },
      ...{ group: undefined, gated: false, pending: [] },
    }
    state.segments.set(mesh, segment)
  }
  return segment
}

/** Root `rank`'s pivot sphere grown into its segment's box. */
function grow<G>(image: Image<G>, segment: CardSegment<G>, rank: number) {
  const centre = segment.entry.centre ?? ORIGIN,
    radius = image.state.watch.radiusOf(rank),
    box = segment.box
  transformAffinePoint(pivot, image.roots[rank].world.elements, centre[0], centre[1], centre[2])
  const first = segment.eligibleCount === 1
  for (let k = 0; k < 3; k++) {
    box[k] = first ? pivot[k] - radius : Math.min(box[k], pivot[k] - radius)
    box[k + 3] = first ? pivot[k] + radius : Math.max(box[k + 3], pivot[k] + radius)
  }
}

/** Root `rank`'s switch now holds: listed with its mesh, its card taken unless the mesh waits. */
function enlist<G>(image: Image<G>, rank: number) {
  const { state, roots } = image,
    segment = segmentOf(state, roots[rank].mesh!)
  if (segment.eligibleCount === segment.eligible.length) {
    const next = new Int32Array(segment.eligible.length * 2)
    next.set(segment.eligible)
    segment.eligible = next
  }
  state.eligibleAt[rank] = segment.eligibleCount
  segment.eligible[segment.eligibleCount++] = rank
  grow(image, segment, rank)
  if (segment.gated) return
  // With its atlas, the card at once; without, the image's view of the mesh decides (`drawable`).
  if (segment.group === undefined) return void segment.pending.push(rank)
  mark(roots, rank, true, image.moved)
  takeCard(image, segment, rank)
}

/** Root `rank`'s switch no longer holds: its card given back, its clusters drawn again. */
function delist<G>(image: Image<G>, rank: number) {
  const { state, roots } = image,
    at = state.eligibleAt[rank]
  if (at < 0) return
  const segment = state.segments.get(roots[rank].mesh!)!
  const last = segment.eligible[--segment.eligibleCount]
  segment.eligible[at] = last
  state.eligibleAt[last] = at
  state.eligibleAt[rank] = -1
  mark(roots, rank, false, image.moved)
  giveCard(image, segment, rank)
}

/** Root `rank`'s card: the record of its world, shared with a root of its mesh placed by the same
 *  world — two primitives of one placement are one card. */
function takeCard<G>(image: Image<G>, segment: CardSegment<G>, rank: number) {
  const { state, roots } = image,
    world = roots[rank].world.elements,
    radius = state.watch.radiusOf(rank)
  // A radius the switch has not taken yet draws no card: the root keeps its clusters.
  if (!(radius > 0)) return mark(roots, rank, false, image.moved)
  if (state.cardOf[rank]) return
  state.cardOf[rank] = world
  const held = segment.holders.get(world)
  if (held) return void held.roots++
  const slot = slotAtEnd(state.slots, state.segments.values(), segment)
  segment.holders.set(world, { slot: segment.count, roots: 1 })
  segment.worlds[segment.count++] = world
  writeCardRecord(state.slots, slot, world, segment.entry, radius)
}

function giveCard<G>(image: Image<G>, segment: CardSegment<G>, rank: number) {
  const { state } = image,
    world = state.cardOf[rank]
  if (!world) return
  state.cardOf[rank] = undefined
  const held = segment.holders.get(world)!
  if (--held.roots) return
  segment.holders.delete(world)
  freeSlot(state.slots, segment, held.slot)
}

/** The roots that moved: their mesh's box grown, their card written again. */
function followMoves<G>(image: Image<G>) {
  const { state, roots } = image
  const follow = (rank: number) => {
    if (rank >= roots.length || state.eligibleAt[rank] < 0) return
    const segment = state.segments.get(roots[rank].mesh!)!
    grow(image, segment, rank)
    const world = state.cardOf[rank],
      held = world && segment.holders.get(world)
    if (held)
      writeCardRecord(
        state.slots,
        segment.start + held.slot,
        world,
        segment.entry,
        state.watch.radiusOf(rank),
      )
  }
  if (state.allMoved) for (let rank = 0; rank < roots.length; rank++) follow(rank)
  else for (const rank of state.moves) follow(rank)
  state.moves.length = 0
  state.allMoved = false
}

/** Each mesh with a switched root whose box the view holds: its atlas asked, its cards taken as it
 *  lands or given back as it leaves, and its run drawn. A mesh out of view leaves the roots that
 *  switched to their card, which draws nothing there either way, until the view asks its atlas. */
function drawable<G>(
  image: Image<G>,
  cam: EngineCamera,
  atlasOf: (mesh: number, maps: ImpostorMaps) => G | undefined,
) {
  const { state } = image
  state.runCount = state.count = 0
  for (const segment of state.segments.values()) {
    const box = segment.box,
      pending = segment.pending
    if (!segment.eligibleCount) {
      pending.length = 0
      continue
    }
    if (frustumExcludesBox(cam.planes, box[0], box[1], box[2], box[3], box[4], box[5])) {
      if (!segment.gated) for (const rank of pending) cardAt(image, segment, rank, true)
      pending.length = 0
      continue
    }
    pending.length = 0
    const group = atlasOf(segment.mesh, segment.entry.maps),
      held = segment.group !== undefined && !segment.gated,
      gated = segment.gated
    Object.assign(segment, { group, gated: group === undefined })
    // In view without its atlas, its roots keep their clusters until it lands; as it lands, each
    // takes its card.
    if (group === undefined ? !gated : !held)
      for (let i = 0; i < segment.eligibleCount; i++)
        cardAt(image, segment, segment.eligible[i], group !== undefined)
    if (group === undefined || !segment.count) continue
    const run = (state.runs[state.runCount++] ??= { group, first: 0, count: 0 })
    Object.assign(run, { group, first: segment.start, count: segment.count })
    state.count += segment.count
  }
}

/** Root `rank`'s card bit set or cleared, its card taken when its mesh's atlas is held. */
function cardAt<G>(image: Image<G>, segment: CardSegment<G>, rank: number, card: boolean) {
  if (image.state.eligibleAt[rank] < 0) return
  mark(image.roots, rank, card, image.moved)
  if (!card) giveCard(image, segment, rank)
  else if (segment.group !== undefined) takeCard(image, segment, rank)
}
