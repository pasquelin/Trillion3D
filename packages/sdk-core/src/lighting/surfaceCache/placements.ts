import { boxTransform } from '../../../../math/src/geometry/box.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../contracts/distanceFieldAbi.ts'
import { DEFAULT_LIGHTING_CHANNELS_MASK } from '../../contracts/lightingChannelsAbi.ts'
import { buildMeshCards, isTracked, moveMeshCards } from './cardScene.ts'
import { mipOf, cardIsAllocated, type Card, type MeshCards } from './cardTypes.ts'
import { atlasPages, createPageAllocator } from './pageAllocator.ts'
import { isMapped, type Placement, type SurfaceCache } from './state.ts'
import { removeCardFromAtlas } from './virtualSurface.ts'

/**
 * THE PLACEMENTS OF THE SCENE the surface cache follows, and the mesh cards each has while it is
 * near enough to be seen: a placement is a mesh at a matrix. It is told to the cache when it is made,
 * moved, changed or removed (`setPlacement`, `removePlacement`, `invalidatePlacement`); whether it has
 * mesh cards is the cache's to decide, from its distance (`cullPlacements`, `requests.ts`).
 */

/** A placement of a mesh, as the scene tells it. */
export interface PlacementSource {
  /** Its matrix, metres, by column. */
  readonly world: ArrayLike<number>
  /** The cards of its mesh. */
  readonly cards: MeshCards
  /** The same for placements of one mesh with the same materials — whose cards may copy one
   *  another —, none for a placement whose cards copy no other; -1 by default. */
  readonly shareId?: number
  /** Whether its mesh lights the scene by its emission: it keeps smaller cards. */
  readonly emissive?: boolean
  /** Whether its material is opaque or masked, true by default: a translucent one has no cards. */
  readonly opaqueOrMasked?: boolean
  /** The mask of the lighting channels of its object, channel 0 alone by default: a light lights its cards only
   *  where it shares one (`../../contracts/lightingChannelsAbi.ts`). */
  readonly lightingChannels?: number
}

/** Puts the box of `placement` in the world, centimetres, and its greater half side. */
function updateBounds(placement: Placement) {
  const { min, max } = placement.mesh
  const box = [...min, ...max]
  const bounds = placement.bounds
  boxTransform(bounds, 0, box, 0, placement.world)
  for (let k = 0; k < 6; k++) bounds[k] *= CM
  placement.extentMax =
    0.5 * Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2])
}

/** Adds the cards of `placement` to the scene: its mesh cards instance, and its cards. They come
 *  with no page; the law asks for them in the image that follows. A placement whose cards are refused
 *  is marked as one that cannot have any. */
export function addMeshCards(cache: SurfaceCache, placement: Placement) {
  if (placement.meshCards >= 0) return
  const built = buildMeshCards(
    placement.id,
    placement.world,
    placement.mesh,
    cache.settings,
    placement,
  )
  if (!built) {
    placement.validMeshCards = false
    return
  }
  const { instance, cards } = built
  instance.firstCard = cache.cards.addSpan(cards.length, (offset) => cards[offset])
  const index = cache.meshCards.addSpan(1, () => instance)
  cards.forEach((card, offset) => {
    card.meshCards = index
    cache.changes.cards.add(instance.firstCard + offset)
  })
  cache.changes.meshCards.add(index)
  cache.changes.placements.add(placement.id)
  placement.meshCards = index
  placement.visible = true
}

/** Removes the cards of `placement` from the scene: they leave the atlas, and the cards and the mesh
 *  cards leave their tables. The placement is no longer visible unless it is itself being removed. */
export function removeMeshCards(cache: SurfaceCache, placement: Placement, hide = true) {
  if (placement.meshCards < 0) return
  const instance = cache.meshCards.at(placement.meshCards)
  for (let at = instance.firstCard; at < instance.firstCard + instance.numCards; at++)
    removeCardFromAtlas(cache, at)
  cache.cards.removeSpan(instance.firstCard, instance.numCards)
  cache.meshCards.removeSpan(placement.meshCards, 1)
  cache.changes.meshCards.add(placement.meshCards)
  cache.changes.placements.add(placement.id)
  placement.meshCards = -1
  if (hide) placement.visible = false
}

/** Removes every placement's cards, and forgets who copies whom. */
export function removeAllMeshCards(cache: SurfaceCache) {
  for (const placement of cache.placements.values()) removeMeshCards(cache, placement)
  cache.sharing.clear()
}

/**
 * Makes the atlas the size the settings ask for, and the kind (`compressed`: its albedo, normal and
 * emission in blocks), under the pre-exposure the cards' light is stored with and in the format `light` it is stored in: when it is not that size, that kind, that
 * pre-exposure or that format already, every card leaves it, and an empty atlas takes its place. Whether it was remade: the textures of the atlas must be made again.
 */
export function updateAtlasSize(
  cache: SurfaceCache,
  compressed: boolean,
  preExposure: number,
  light: string,
) {
  const pages = atlasPages(cache.settings)
  if (
    pages === cache.atlasPages &&
    compressed === cache.compressed &&
    preExposure === cache.preExposure &&
    light === cache.light
  )
    return false
  removeAllMeshCards(cache)
  cache.allocator = createPageAllocator(pages, pages)
  cache.atlasPages = pages
  cache.compressed = compressed
  cache.preExposure = preExposure
  cache.light = light
  return true
}

/** Moves the cards of `placement` to its matrix, and tells the tables. */
function moveCards(cache: SurfaceCache, placement: Placement) {
  if (placement.meshCards < 0) return
  const instance = cache.meshCards.at(placement.meshCards)
  const cards: Card[] = []
  for (let at = instance.firstCard; at < instance.firstCard + instance.numCards; at++)
    cards.push(cache.cards.at(at))
  if (!moveMeshCards(instance, cards, placement.world)) return
  cache.changes.meshCards.add(placement.meshCards)
  for (let at = instance.firstCard; at < instance.firstCard + instance.numCards; at++)
    cache.changes.cards.add(at)
}

/** Gives `placement` the lighting channels `mask`: its cards' records are written again, nothing else of them changes. */
function setChannels(cache: SurfaceCache, placement: Placement, mask: number) {
  if (placement.lightingChannels === mask) return
  placement.lightingChannels = mask
  if (placement.meshCards < 0) return
  const instance = cache.meshCards.at(placement.meshCards)
  instance.lightingChannels = mask
  for (let at = instance.firstCard; at < instance.firstCard + instance.numCards; at++)
    cache.changes.cards.add(at)
}

/**
 * Tells the cache that the placement `id` — a small whole number, the placement's rank in the table
 * that takes it to its mesh cards — is a mesh at a matrix. A placement the cache follows already
 * with the same mesh and properties is moved; another is made anew. A placement whose largest face is
 * too small for a card is not followed at all.
 */
export function setPlacement(cache: SurfaceCache, id: number, source: PlacementSource) {
  const emissive = source.emissive ?? false
  const shareId = source.shareId ?? -1
  const opaqueOrMasked = source.opaqueOrMasked ?? true
  const lightingChannels = source.lightingChannels ?? DEFAULT_LIGHTING_CHANNELS_MASK
  const known = cache.placements.get(id)
  if (
    known &&
    known.mesh === source.cards &&
    known.shareId === shareId &&
    known.emissive === emissive &&
    known.opaqueOrMasked === opaqueOrMasked
  ) {
    known.world.set(source.world)
    updateBounds(known)
    moveCards(cache, known)
    setChannels(cache, known, lightingChannels)
    return
  }
  if (known) removePlacement(cache, id)
  if (!isTracked(source.world, source.cards, cache.settings, emissive)) return
  const placement: Placement = {
    id,
    world: Float64Array.from(source.world),
    mesh: source.cards,
    shareId,
    emissive,
    opaqueOrMasked,
    lightingChannels,
    bounds: new Float64Array(6),
    extentMax: 0,
    visible: false,
    validMeshCards: true,
    meshCards: -1,
  }
  updateBounds(placement)
  cache.placements.set(id, placement)
}

/** Forgets the placement `id`: its cards leave the scene. */
export function removePlacement(cache: SurfaceCache, id: number) {
  const placement = cache.placements.get(id)
  if (!placement) return
  removeMeshCards(cache, placement, false)
  cache.placements.delete(id)
}

/** The placement `id` changed its surface — a material, a texture —: every page of its cards that is
 *  in the atlas is captured again, the oldest request first. */
export function invalidatePlacement(cache: SurfaceCache, id: number) {
  const placement = cache.placements.get(id)
  if (!placement || placement.meshCards < 0) return
  const instance = cache.meshCards.at(placement.meshCards)
  for (let at = instance.firstCard; at < instance.firstCard + instance.numCards; at++) {
    const card = cache.cards.at(at)
    if (!cardIsAllocated(card)) continue
    for (let level = card.minResLevel; level <= card.maxResLevel; level++) {
      const mip = mipOf(card, level)
      if (mip.spanSize === 0) continue
      for (let local = 0; local < mip.spanSize; local++) {
        const index = mip.spanOffset + local
        if (isMapped(cache.pages.at(index))) cache.recapture.add(cache.frame, index)
      }
    }
  }
}
