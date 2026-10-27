import { boxPointDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { distanceSqVector3 } from '../../../../math/src/vector/vector.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'
import type { GlobalDistanceFieldSettings } from '../../contracts/globalDistanceFieldOptions.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { clampCameraOffset } from '../globalDistanceField.ts'
import {
  DISTANCE_BINS,
  cardResLevel,
  distanceBin,
  viewerDistance,
  type CardLimits,
} from './cardResolution.ts'
import { setDesiredLevel, type MeshCardsInstance, type Vec3 } from './cardTypes.ts'
import { feedbackRequests, type Feedback } from './feedback.ts'
import { INT32_MAX } from '../../contracts/settingRules.ts'
import { surfaceCacheFrozen } from './lightingMath.ts'
import { addMeshCards, removeMeshCards } from './placements.ts'
import { LOCKED_MIP, type Placement, type SurfaceCache, type SurfaceRequest } from './state.ts'
import { removeCardFromAtlas } from './virtualSurface.ts'

/**
 * THE REQUESTS: what the surface cache asks of itself each image. Two passes over the scene.
 *
 * The first decides which PLACEMENTS have mesh cards (`cullPlacements`): one within the distance of
 * the outermost clipmap whose largest face would reach the least resolution gets them, the nearest
 * first, from the room of twice as many as an image captures; one that no longer qualifies loses
 * them, at most `surfaceCacheRemovesPerFrame` in an image.
 *
 * The second asks the law about every CARD of every mesh cards (`planRequests`): the eye's distance
 * to its box gives the resolution level it should be kept at (`cardResLevel`), or none. A card
 * that left the law is taken out of the atlas. A card whose level is not the one its coarsest mip
 * was made for makes a REQUEST for that mip. Requests are sorted into 16 bins by the log2 of their
 * distance, the nearest first, and cut at the budget of captures an image has
 * (`surfaceCacheCardCapturesPerFrame`): all the requests of the nearer bins, and as many of the
 * last bin as are left. The requests of the finer pages the feedback asks for (`feedbackRequests`)
 * share the bins, behind the coarse ones of their distance.
 */

/** The mesh cards the law is asked about in one slice of the scene: the order of the requests in a
 *  bin is the order of the slices, then of the mesh cards. */
const MESH_CARDS_PER_SLICE = 128
/** The distance a card that already has a level is pushed back by, to be served after the cards that
 *  have none: the less the level changes, the more. */
const LEVEL_CHANGE_PUSH = 2500

/** What the passes of an image look at: the eyes and the view. */
export interface CardView {
  /** Where the eyes are, centimetres: the camera, and any other view the scene is kept for. */
  readonly origins: readonly Vec3[]
  /** Whether the view is orthographic: it takes its own least resolution. */
  readonly orthographic: boolean
  /** The half side, in centimetres, of the outermost clipmap of the global distance field. */
  readonly clipmapExtent: number
  /** Whether placements with a translucent material get cards too; false by default. */
  readonly addTranslucent?: boolean
}

/** What the cache remembers of the main view's origin between images, for the frozen origin: whether it follows the eye,
 *  and the eye it was last left at. */
export interface ViewOriginHold {
  following: boolean
  frozenAt: [number, number, number]
}

export const createViewOriginHold = (): ViewOriginHold => ({
  following: true,
  frozenAt: [0, 0, 0],
})

/**
 * Writes into `out` the origin the cache keeps its cards for the view whose eye is `eye`: the eye moved ahead by the camera's
 * velocity offset of the global distance field (`offset`, centimetres), which for the outermost clipmap `clipmap` past the
 * first is held within three quarters of that clipmap's extent. While `update` is off (`surfaceCacheUpdateViewOrigin`) the
 * origin stays where the eye was when it turned off; the offset is not applied to it.
 */
export function viewOriginOf(
  out: [number, number, number],
  eye: Vec3,
  offset: Vec3,
  hold: ViewOriginHold,
  update: boolean,
  clipmap: number,
  field: GlobalDistanceFieldSettings,
) {
  const drift = clipmap > 0 ? clampCameraOffset(offset, field, clipmap) : offset
  for (let k = 0; k < 3; k++) out[k] = eye[k] + drift[k]
  if (update) hold.following = true
  else if (hold.following) {
    for (let k = 0; k < 3; k++) hold.frozenAt[k] = eye[k]
    hold.following = false
  }
  if (!hold.following) for (let k = 0; k < 3; k++) out[k] = hold.frozenAt[k]
  return out
}

/** The most views the cache keeps an origin for: one image's streaming origins fill the list up to it. */
const MAX_VIEW_ORIGINS = 2

/** Adds the origins of the streaming views to `origins`, which holds the main view's, kept whatever the threshold: each only if it lies
 *  `threshold` centimetres (`surfaceCacheViewOriginDistanceThreshold`) or more from every origin held, and
 *  while fewer than `MAX_VIEW_ORIGINS` are. */
export function addStreamingViewOrigins(
  origins: Vec3[],
  streaming: readonly Vec3[],
  threshold: number,
) {
  const squared = threshold * threshold
  for (const origin of streaming) {
    if (origins.length >= MAX_VIEW_ORIGINS) return
    if (origins.every((held) => distanceSqVector3(origin, held) >= squared)) origins.push(origin)
  }
}

/** The captures an image may make: the budget, doubled for a fast camera. */
export const maxCapturesPerFrame = (settings: SurfaceCacheSettings) =>
  Math.max(
    settings.surfaceCacheCardCapturesPerFrame * (settings.surfaceCacheFastCameraMode ? 2 : 1),
    0,
  )

/** The tiles an image may capture: none while the cache is frozen, all of them while it is recaptured every image
 *  (`surfaceCacheRecaptureEveryFrame`), else the budget (`maxCapturesPerFrame`). */
export const maxTileCapturesPerFrame = (settings: SurfaceCacheSettings) => {
  if (surfaceCacheFrozen(settings)) return 0
  return settings.surfaceCacheRecaptureEveryFrame ? INT32_MAX : maxCapturesPerFrame(settings)
}

/** The distance from the eyes to the box `bounds` (`minX..maxZ`): that of the nearest. */
function nearestDistance(bounds: ArrayLike<number>, origins: readonly Vec3[]) {
  let nearest = Infinity
  for (const [x, y, z] of origins) nearest = Math.min(nearest, boxPointDistance(bounds, 0, x, y, z))
  return nearest
}

/** The placements that deserve mesh cards: in range, with a face of the least resolution, opaque or
 *  masked unless `addTranslucent`. */
function wantsCards(
  placement: Placement,
  distance: number,
  limits: CardLimits,
  addTranslucent: boolean,
) {
  const resolution = (limits.texelDensity * placement.extentMax) / Math.max(distance, 1) + 0.01
  const least = placement.emissive ? 1 : limits.minResolution
  return (
    distance <= limits.maxDistance &&
    resolution >= least &&
    (placement.opaqueOrMasked || addTranslucent)
  )
}

/**
 * Gives mesh cards to the placements that deserve them and takes them from those that no longer
 * do. The placements that want cards and have none are counted (`stats.meshCardsToAdd`); the
 * nearest, up to twice the captures of an image, get them.
 */
export function cullPlacements(cache: SurfaceCache, view: CardView, limits: CardLimits) {
  const { settings } = cache
  const adds: { placement: Placement; distance: number }[] = []
  const removes: Placement[] = []
  for (const placement of cache.placements.values()) {
    const distance = nearestDistance(placement.bounds, view.origins)
    if (wantsCards(placement, distance, limits, view.addTranslucent ?? false)) {
      if (!placement.visible && placement.validMeshCards) adds.push({ placement, distance })
    } else if (placement.visible && removes.length < settings.surfaceCacheRemovesPerFrame) {
      removes.push(placement)
    }
  }
  cache.stats.meshCardsToAdd = adds.length
  for (const placement of removes) removeMeshCards(cache, placement)
  adds.sort((a, b) => a.distance - b.distance)
  for (const { placement } of adds.slice(0, 2 * maxCapturesPerFrame(settings)))
    addMeshCards(cache, placement)
}

/** What a slice of the scene asked: the requests, the cards that left the law, the requests in each
 *  bin, and the change of the texels wanted. */
interface Plan {
  readonly requests: SurfaceRequest[]
  readonly hide: number[]
  readonly histogram: Int32Array
  desiredTexels: number
}

/** Puts the eyes in the space of the mesh cards, into `eyes`: each taken from the instance's origin
 *  and turned by its rotation, three numbers each. */
function eyesInMeshSpace(
  instance: MeshCardsInstance,
  origins: readonly Vec3[],
  eyes: Float64Array,
) {
  const { localToWorld: m, rotation: r } = instance
  origins.forEach(([x, y, z], eye) => {
    const dx = x - m[12],
      dy = y - m[13],
      dz = z - m[14]
    for (let k = 0; k < 3; k++)
      eyes[eye * 3 + k] = r[k * 3] * dx + r[k * 3 + 1] * dy + r[k * 3 + 2] * dz
  })
}

/** The request for the coarsest mip of card `index` at `level`, if its level changed: counted into
 *  the plan's bin. */
function planCard(cache: SurfaceCache, index: number, level: number, distance: number, plan: Plan) {
  const card = cache.cards.at(index)
  plan.desiredTexels += setDesiredLevel(card, level)
  if (level === card.desiredOnLastAlloc) return
  let pushed = distance
  if (card.visible) {
    // A card that has a level already waits behind the new ones, the less its level changes.
    const change = Math.abs(card.desiredOnLastAlloc - level)
    pushed += (1 - saturate((change + 1) / 3)) * LEVEL_CHANGE_PUSH
  }
  const bin = distanceBin(pushed)
  plan.histogram[bin]++
  plan.requests.push({ card: index, resLevel: level, localPage: LOCKED_MIP, bin })
}

/** Asks the law about the cards of the `count` mesh cards from `first`. */
function planSlice(
  cache: SurfaceCache,
  first: number,
  count: number,
  origins: readonly Vec3[],
  limits: CardLimits,
): Plan {
  const plan: Plan = {
    requests: [],
    hide: [],
    histogram: new Int32Array(DISTANCE_BINS),
    desiredTexels: 0,
  }
  const end = Math.min(first + count, cache.meshCards.length)
  const eyes = new Float64Array(origins.length * 3)
  for (let at = first; at < end; at++) {
    if (!cache.meshCards.has(at)) continue
    const instance = cache.meshCards.at(at)
    const least = instance.emissive ? 1 : limits.minResolution
    eyesInMeshSpace(instance, origins, eyes)
    for (let index = instance.firstCard; index < instance.firstCard + instance.numCards; index++) {
      const card = cache.cards.at(index)
      let distance = Infinity
      for (let e = 0; e < eyes.length; e += 3)
        distance = Math.min(
          distance,
          viewerDistance(boxPointDistance(card.box, 0, eyes[e], eyes[e + 1], eyes[e + 2])),
        )
      const level = cardResLevel(distance, card.maxExtent, instance.resolutionScale, least, limits)
      if (level >= 0) planCard(cache, index, level, distance, plan)
      else if (card.visible) plan.hide.push(index)
    }
  }
  return plan
}

/**
 * Cuts the requests of the slices at the budget: those of the bins nearer than the one the budget
 * ends in, and as many of that bin as the budget leaves, in the order of the slices. The cut counts
 * the plain budget where the check of whether it was reached counts the doubled one of a fast
 * camera.
 */
function cutAtBudget(
  slices: readonly Plan[],
  histogram: Int32Array,
  settings: SurfaceCacheSettings,
) {
  const budget = settings.surfaceCacheCardCapturesPerFrame
  const reach = maxCapturesPerFrame(settings)
  let count = 0,
    lastBinCount = 0,
    lastBin = 0
  for (; lastBin < DISTANCE_BINS; lastBin++) {
    count += histogram[lastBin]
    if (count >= reach) {
      lastBinCount = budget - (count - histogram[lastBin])
      count = budget
      break
    }
  }
  const served: SurfaceRequest[] = []
  if (count === 0) return served
  for (const slice of slices) {
    for (const request of slice.requests) {
      if (request.bin > lastBin) continue
      if (request.bin === lastBin) {
        if (lastBinCount === 0) continue
        lastBinCount--
      }
      served.push(request)
      if (--count === 0) return served
    }
  }
  return served
}

/**
 * Asks the law about every card, takes the cards it no longer keeps out of the atlas, takes in the
 * feedback of the rays, and returns the requests this image serves, nearest first.
 */
export function planRequests(
  cache: SurfaceCache,
  view: CardView,
  limits: CardLimits,
  feedback?: Feedback,
) {
  const slices: Plan[] = []
  const sliceCount = ceilDiv(cache.meshCards.length, MESH_CARDS_PER_SLICE)
  for (let slice = 0; slice < sliceCount; slice++)
    slices.push(
      planSlice(cache, slice * MESH_CARDS_PER_SLICE, MESH_CARDS_PER_SLICE, view.origins, limits),
    )
  if (slices.length === 0) return []
  const histogram = new Int32Array(DISTANCE_BINS)
  for (const slice of slices) {
    cache.stats.lockedCardsToUpdate += slice.requests.length
    cache.stats.desiredTexels += slice.desiredTexels
    for (let bin = 0; bin < DISTANCE_BINS; bin++) histogram[bin] += slice.histogram[bin]
    for (const index of slice.hide) {
      const card = cache.cards.at(index)
      if (!card.visible) continue
      card.visible = false
      removeCardFromAtlas(cache, index)
    }
  }
  if (feedback && cache.settings.surfaceCacheFeedback)
    feedbackRequests(cache, feedback, view.origins, slices[0].requests, histogram)
  return cutAtBudget(slices, histogram, cache.settings)
}
