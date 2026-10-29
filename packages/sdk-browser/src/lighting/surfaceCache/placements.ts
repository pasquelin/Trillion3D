import { DEFAULT_LIGHTING_CHANNELS_MASK } from '../../../../sdk-core/src/contracts/lightingChannelsAbi.ts'
import type { MeshCards } from '../../../../sdk-core/src/lighting/meshCardsFile.ts'
import { meshCardsFromBounds } from '../../../../sdk-core/src/lighting/surfaceCache/boundsCards.ts'
import {
  invalidatePlacement,
  removePlacement,
  setPlacement,
} from '../../../../sdk-core/src/lighting/surfaceCache/placements.ts'
import type { SurfaceCache } from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { cardRootVisible, keyOf } from '../distanceField/objectTable.ts'
import { hardwareRayTracing } from '../rays/hardwareRayTracing.ts'
import type { TrackedRoot } from '../distanceField/objectTracker.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * THE PLACEMENTS THE SURFACE CACHE FOLLOWS, kept level with the cut's roots: a root whose mesh keeps
 * cards is a placement of them (the roots that place the same mesh at the same world — one for each
 * primitive of a mesh — are one), and the HLOD cells' cards are placed by the stand-ins the cells'
 * fields are (`../distanceField/hlodObjects.ts`), the very roots the distance fields' scene placed
 * (`MeshFieldScene.roots`), while the cut draws their actors. A placement is told to the cache
 * (`setPlacement`) when it appears, moves or is shown again, and forgotten (`removePlacement`) when
 * its root is gone or hidden; one whose material was written since is invalidated, its pages captured
 * again. Each placement has a number — a small whole number, kept while it stands — that names it to
 * the tables and to the raster of the cards; it is held under the key of the world it stands at now
 * (`keyOf`, the distance fields' too), so a placement that moved is the same one when the roots are
 * read again as a whole.
 *
 * The roots are read as they are, never changed. The whole table is walked again only when the roots'
 * list changed shape; an image otherwise polls the placements it holds.
 */

/** The roots the cache's placements follow, and the reflections' hit table ranks (`hitInstances.ts`): the
 *  ones the distance fields' scene placed, the HLOD cells' stand-ins among them, else the cut's. The one
 *  spelling of that list. */
export const cacheRootsOf = (rt: Pick<WebgpuPagesRuntime, 'distanceFields' | 'layout'>) =>
  rt.distanceFields?.scene.meshes.roots ?? rt.layout.selectionRoots

/** What the placements read of a root beyond what the distance fields' tracker does: the surface
 *  it wears, which says how it is captured. */
export interface CardRoot extends TrackedRoot {
  /** Whether its primitive was cut at run time (`ClusterRoot.runtime`): it has no compiled cards, and its box, `localBox`, makes them. */
  readonly runtime?: boolean
  readonly localBox?: Float64Array
  readonly worn?: {
    readonly surface: {
      readonly version: number
      readonly transparent: boolean
      readonly emissive: readonly number[]
      readonly emissiveMap?: unknown
    }
  }
}

/** A placement held: its number, the root it follows, every root of the list that stands as it does (the roots of
 *  one mesh at one world, its root among them), the cards of its mesh and what it was last told as. */
interface Held {
  readonly id: number
  root: CardRoot
  roots: readonly TrackedRoot[]
  readonly cards: MeshCards
  key: string
  version: number
  live: boolean
  surfaceVersion: number
  channels: number
}

/** The matrix of `root`, by column. */
const worldOf = (root: CardRoot) => root.world.elements

/** Whether `surface` emits light: its colour factor or a map of it. */
const emits = (surface: NonNullable<CardRoot['worn']>['surface']) =>
  surface.emissiveMap !== undefined || Math.max(...surface.emissive) > 0

/** What the placements of a scene keep between two syncs. */
interface PlacementState {
  byMesh: Map<MeshCards['mesh'], MeshCards>
  byCell: Map<MeshCards['mesh'], MeshCards>
  held: Set<Held>
  ids: Map<number, Held>
  free: number[]
  shares: Map<string, number>
  surfaces: WeakMap<object, number>
  surfaceCount: number
  /** The cards made from the box of each run-time primitive, by that box (shared by all its placements), and whether the setting
   *  `runtimeMeshCards` asks for them as the roots were last read. */
  fromBounds: WeakMap<Float64Array, MeshCards>
  runtimeCount: number
  runtimeCards: boolean
  nextId: number
}

/** A number for each surface met, from 0. */
function surfaceId(state: PlacementState, surface: object) {
  const known = state.surfaces.get(surface)
  if (known !== undefined) return known
  state.surfaces.set(surface, state.surfaceCount)
  return state.surfaceCount++
}

/** The cards a root places: those made from the box of a run-time primitive where the setting asks, else its mesh's, or its cell's. */
function cardsOf(state: PlacementState, root: CardRoot) {
  if (root.runtime) return state.runtimeCards ? boundsCardsOf(state, root) : undefined
  return root.field
    ? state.byCell.get(root.field.mesh)
    : root.mesh === undefined
      ? undefined
      : state.byMesh.get(root.mesh)
}

/** The cards of a run-time primitive, made once from its box: its own number, below zero where no compiled mesh's is. */
function boundsCardsOf(state: PlacementState, root: CardRoot) {
  const box = root.localBox
  if (!box) return undefined
  let cards = state.fromBounds.get(box)
  if (!cards)
    state.fromBounds.set(box, (cards = meshCardsFromBounds(-1 - state.runtimeCount++, box)))
  return cards
}

/** The number the placements of one mesh wearing one surface share: theirs may copy one another. */
function shareOf(state: PlacementState, cardsOfMesh: MeshCards, root: CardRoot) {
  const surface = root.worn?.surface
  if (!surface || cardsOfMesh.hlodCell) return -1
  const key = `${cardsOfMesh.mesh}:${surfaceId(state, surface)}`
  const known = state.shares.get(key)
  if (known !== undefined) return known
  state.shares.set(key, state.shares.size)
  return state.shares.size - 1
}

/** Tells the cache the placement `entry` stands as its root has it now. */
function tell(state: PlacementState, cache: SurfaceCache, entry: Held, channels: number) {
  const surface = entry.root.worn?.surface
  setPlacement(cache, entry.id, {
    world: worldOf(entry.root),
    cards: entry.cards,
    shareId: shareOf(state, entry.cards, entry.root),
    emissive: surface ? emits(surface) : false,
    opaqueOrMasked: surface ? !surface.transparent : true,
    lightingChannels: channels,
  })
  entry.channels = channels
  entry.version = entry.root.worldAt ?? 0
  entry.key = keyOf(entry.cards, entry.root)
  entry.live = true
}

function release(state: PlacementState, cache: SurfaceCache, entry: Held) {
  removePlacement(cache, entry.id)
  state.held.delete(entry)
  state.ids.delete(entry.id)
  state.free.push(entry.id)
}

/** Reads the roots again as a whole: the placements gone forgotten, the new ones told. */
function resync(state: PlacementState, cache: SurfaceCache, roots: readonly CardRoot[]) {
  const wanted = new Map<string, { root: CardRoot; cards: MeshCards; roots: TrackedRoot[] }>()
  for (const root of roots) {
    const own = cardsOf(state, root)
    if (!own) continue
    const key = keyOf(own, root)
    const same = wanted.get(key)
    if (same) same.roots.push(root)
    else wanted.set(key, { root, cards: own, roots: [root] })
  }
  for (const entry of [...state.held]) {
    const same = wanted.get(entry.key)
    if (!same || same.cards !== entry.cards) release(state, cache, entry)
    else {
      entry.root = same.root
      entry.roots = same.roots
      wanted.delete(entry.key)
    }
  }
  for (const [key, { root, cards: own, roots: sharing }] of wanted) {
    const id = state.free.pop() ?? state.nextId++
    const entry: Held = {
      id,
      root,
      roots: sharing,
      cards: own,
      key,
      version: NaN,
      live: false,
      surfaceVersion: root.worn?.surface.version ?? 0,
      channels: DEFAULT_LIGHTING_CHANNELS_MASK,
    }
    state.held.add(entry)
    state.ids.set(id, entry)
  }
}

/** Brings each placement held to the state of its root: moved, shown or hidden, its object's lighting channels
 *  changed (`channelsOf`, by the placement), its material written. */
function poll(state: PlacementState, cache: SurfaceCache, channelsOf: (entry: Held) => number) {
  for (const entry of state.held) {
    const visible = cardRootVisible(entry.root, hardwareRayTracing())
    if (!visible) {
      if (entry.live) {
        removePlacement(cache, entry.id)
        entry.live = false
      }
      continue
    }
    const version = entry.root.worldAt ?? 0
    const channels = channelsOf(entry)
    if (!entry.live || version !== entry.version || channels !== entry.channels)
      tell(state, cache, entry, channels)
    const surfaceVersion = entry.root.worn?.surface.version ?? 0
    if (surfaceVersion !== entry.surfaceVersion) {
      entry.surfaceVersion = surfaceVersion
      invalidatePlacement(cache, entry.id)
    }
  }
}

/** The rank, in the cut's tables, each root of a list stands as: kept for the list it was last asked of. */
function createRanker() {
  /** The rank of each root of the list the ranks were last asked of, in the cut's tables. */
  const ranks = new Map<TrackedRoot, number>()
  let ranked: readonly TrackedRoot[] | undefined
  let rankedCount = -1
  /** The rank, in the cut's tables, `root` of `roots` stands as, -1 for a root that is none of them. */
  return (root: TrackedRoot | undefined, roots: readonly TrackedRoot[]) => {
    if (ranked !== roots || rankedCount !== roots.length) {
      ranks.clear()
      roots.forEach((each, rank) => ranks.set(each, each.standsFor ?? rank))
      ranked = roots
      rankedCount = roots.length
    }
    return (root && ranks.get(root)) ?? -1
  }
}

/** No placement held, for the meshes whose cards are `cards`. */
function emptyPlacementState(cards: readonly MeshCards[]): PlacementState {
  return {
    byMesh: new Map(cards.filter((c) => !c.hlodCell).map((c) => [c.mesh, c])),
    byCell: new Map(cards.filter((c) => c.hlodCell).map((c) => [c.mesh, c])),
    held: new Set<Held>(),
    ids: new Map<number, Held>(),
    free: [],
    shares: new Map<string, number>(),
    surfaces: new WeakMap<object, number>(),
    surfaceCount: 0,
    fromBounds: new WeakMap(),
    runtimeCount: 0,
    runtimeCards: false,
    nextId: 0,
  }
}

/** The placements of the scene whose meshes' cards are `cards`. */
export function createCardPlacements(cards: readonly MeshCards[]) {
  const state = emptyPlacementState(cards)
  let lastRoots: readonly TrackedRoot[] | undefined
  let lastCount = -1
  let lastEpoch = NaN
  const rankOfRoot = createRanker()

  return {
    /** How many placements are held. */
    get count() {
      return state.held.size
    },
    /** The roots the placement `id` stands for, as the list was last read: the roots of its mesh at its world, one for
     *  each primitive the mesh has, so that a ray that met any primitive finds the cards. None for a number that names none. */
    rootsOf: (id: number): readonly TrackedRoot[] => state.ids.get(id)?.roots ?? [],
    /**
     * The rank, in the cut's tables, of the placement the root of placement `id` stands as, in `roots`
     * — the list the placements follow (`cacheRootsOf`): a root of the cut is its place in the list, a
     * stand-in for an actor of the world DAG (`TrackedRoot.standsFor`) the world DAG's. -1 for a number
     * that names none.
     */
    rankOf: (id: number, roots: readonly TrackedRoot[]) =>
      rankOfRoot(state.ids.get(id)?.root, roots),
    /** The root placement `id` follows, none for a number that names none. */
    rootOf: (id: number): CardRoot | undefined => state.ids.get(id)?.root,
    /**
     * Brings the cache's placements level with `roots` — the cut's, the HLOD cells' stand-ins joined to
     * them while the cut draws the cells' actors (`MeshFieldScene.roots`) —; `epoch` changes when the
     * scene changed shape; `channelsOfRank` gives the mask of the lighting channels of the object of the cut's root of a
     * rank (`rankOf`); `runtimeCards` says whether the run-time primitives get cards made from their boxes (`runtimeMeshCards`).
     */
    sync(
      cache: SurfaceCache,
      roots: readonly TrackedRoot[],
      epoch: number,
      channelsOfRank: (rank: number) => number,
      runtimeCards: boolean,
    ) {
      if (
        roots !== lastRoots ||
        roots.length !== lastCount ||
        epoch !== lastEpoch ||
        runtimeCards !== state.runtimeCards
      ) {
        state.runtimeCards = runtimeCards
        lastRoots = roots
        lastCount = roots.length
        lastEpoch = epoch
        resync(state, cache, roots)
      }
      poll(state, cache, (entry) => channelsOfRank(rankOfRoot(entry.root, roots)))
    },
  }
}

/** The surface cache's placements of a scene (`createCardPlacements`). */
export type CardPlacements = ReturnType<typeof createCardPlacements>
