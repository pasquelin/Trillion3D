import { addNearest, nearestDistance, noteOp, wantsCards, type CardView } from './requests.ts'
import type { CardLimits } from './cardResolution.ts'
import { removeMeshCards } from './placements.ts'
import type { Placement, SurfaceCache } from './state.ts'

/**
 * THE UPDATE OF THE SCENE DECIDED BY THE GPU (`surfaceCacheGpuDrivenUpdate`): the test that gives mesh
 * cards to the placements near enough to be seen and takes them from those that are not
 * (`cullPlacements`, `requests.ts`) is made by a pass of the GPU over a table of the placements
 * (`groupWords`), which lists the placements to add, with their squared distance, and those to remove.
 * The CPU reads both lists back a few images late (`SceneOps`) and applies them (`applySceneOps`) under the
 * limits of the CPU's test: the nearest adds, twice as many as an image captures, and the removes
 * `surfaceCacheRemovesPerFrame`.
 */

/** The placements the pass lists at most, to add and to remove. */
export const MAX_SCENE_ADD_OPS = 1024
export const MAX_SCENE_REMOVE_OPS = 1024

/** The words of a placement's record in the table the pass reads: the centre of its box and the index of its mesh cards, then the
 *  half sides of its box and its flags. */
export const GROUP_WORDS = 8

/** The flags of a record. */
export const GROUP_FLAGS = {
  /** The record is a placement's: a removed one is all zeros. */
  placed: 1,
  /** The placement can have mesh cards (`Placement.validMeshCards`). */
  validMeshCards: 2,
  /** Its mesh lights the scene by its emission: it keeps smaller cards. */
  emissive: 4,
  /** Its material is opaque or masked. */
  opaqueOrMasked: 8,
} as const

/** The index of a placement with no mesh cards, as a record holds it. */
export const NO_MESH_CARDS_WORD = 0xffffffff

/** The lists the pass wrote, as they were read back: for the adds, the count then pairs of the placement and its squared distance
 *  (an `f32`'s bits); for the removes, the count then the placements. The count may pass the room of the list. */
export interface SceneOps {
  readonly add: Uint32Array
  readonly remove: Uint32Array
}

/** Writes at `at` of `f32` and `u32`, two views of one buffer, the record of `placement`, all zeros for none. */
export function writeGroupWords(
  f32: Float32Array,
  u32: Uint32Array,
  at: number,
  placement: Placement | undefined,
) {
  u32.fill(0, at, at + GROUP_WORDS)
  if (!placement) return
  const { bounds } = placement
  for (let k = 0; k < 3; k++) {
    f32[at + k] = 0.5 * (bounds[k]! + bounds[k + 3]!)
    f32[at + 4 + k] = 0.5 * (bounds[k + 3]! - bounds[k]!)
  }
  u32[at + 3] = placement.meshCards >= 0 ? placement.meshCards : NO_MESH_CARDS_WORD
  u32[at + 7] =
    GROUP_FLAGS.placed |
    (placement.validMeshCards ? GROUP_FLAGS.validMeshCards : 0) |
    (placement.emissive ? GROUP_FLAGS.emissive : 0) |
    (placement.opaqueOrMasked ? GROUP_FLAGS.opaqueOrMasked : 0)
}

/**
 * Applies the lists the GPU's pass wrote, each placement tested again against the eyes and limits of this image (the lists are a few
 * images old): a placement to remove that wants its cards again, or one to add that no longer does, is skipped, as one that changed
 * (gone, no cards possible, cards given already). The placements to remove lose their mesh cards, at most
 * `surfaceCacheRemovesPerFrame`; those to add are counted (`stats.meshCardsToAdd`) and the nearest get them. The debug table keeps the
 * counts and first placements of the lists applied last.
 */
export function applySceneOps(
  cache: SurfaceCache,
  ops: SceneOps,
  view: CardView,
  limits: CardLimits,
) {
  const { addOps, removeOps } = cache.stats
  addOps.fill(0)
  removeOps.fill(0)
  const addTranslucent = view.addTranslucent ?? false
  const wants = (placement: Placement) =>
    wantsCards(placement, nearestDistance(placement.bounds, view.origins), limits, addTranslucent)
  const removes = Math.min(ops.remove[0]!, ops.remove.length - 1)
  let removed = 0
  for (let k = 1; k <= removes; k++) {
    noteOp(removeOps, ops.remove[k]!)
    const placement = cache.placements.get(ops.remove[k]!)
    if (!placement || placement.meshCards < 0 || wants(placement)) continue
    if (removed < cache.settings.surfaceCacheRemovesPerFrame) {
      removeMeshCards(cache, placement)
      removed++
    }
  }
  const adds: { placement: Placement; distance: number }[] = []
  const count = Math.min(ops.add[0]!, (ops.add.length >> 1) - 1)
  for (let k = 1; k <= count; k++) {
    const placement = cache.placements.get(ops.add[2 * k]!)
    if (!placement || !placement.validMeshCards || placement.visible || !wants(placement)) continue
    adds.push({ placement, distance: nearestDistance(placement.bounds, view.origins) })
    noteOp(addOps, placement.id)
  }
  addNearest(cache, adds)
}
