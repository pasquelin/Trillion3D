/**
 * The CPU half of the invalidation (step 7): the engine's change boxes as one phase of
 * (box, map) instances, filtered per light (`vsmInvalidationPhaseFromShadowBoxes`). Its GPU half,
 * the dispatch that stales their pages, is `invalidationPass.ts`.
 */
import type {
  VsmCacheManager,
  VsmInstanceInvalidation,
  VsmInvalidationBatch,
  VsmLightCache,
} from './cacheManager.ts'
import { UNBOUNDED_EXTENT } from './invalidationWgsl.ts'
import { boxCenter } from '../../../math/src/geometry/box.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import { vsmMapWord } from './staleMapWgsl.ts'

/** Words of a phase's box (`VsmInvalidationPhase.boxes`): its world centre, its half extent, and
 *  1 when it is cached as dynamic, else 0. */
export const BOX_WORDS = 7

/** One invalidation call: the collector's batch and the boxes its instances name — box `b` at
 *  `BOX_WORDS · b`, each drawn as one instance of identity rotation (`packBox`, `invalidationPack.ts`). */
export interface VsmInvalidationPhase {
  batch: VsmInvalidationBatch
  boxes: Float64Array
}

/** The engine's change list (`sdk-core/src/scene/light-shadow/changes.ts`, `createShadowChanges`). */
interface VsmShadowBoxSource {
  readonly count: number
  read(box: number): {
    min: ArrayLike<number>
    max: ArrayLike<number>
    moving: boolean
  }
}

/** The last box `writeBox` wrote, centre then half extent, as the lights' range test reads it. */
const lastBox = new Float64Array(6)

/** Writes the box `[min, max]` at `at` of `boxes` (`BOX_WORDS`) and into `lastBox`: its centre and
 *  half extent, the unbounded box when they are not finite or the box is inverted; false then. */
function writeBox(
  boxes: Float64Array,
  at: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  moving: boolean,
) {
  boxCenter(lastBox, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  let finite = true
  for (let a = 0; a < 3; a++) {
    lastBox[3 + a] = (max[a] - min[a]) * 0.5
    finite &&= Number.isFinite(lastBox[a]) && Number.isFinite(lastBox[3 + a]) && lastBox[3 + a] >= 0
  }
  if (!finite) {
    lastBox.fill(0, 0, 3)
    lastBox.fill(UNBOUNDED_EXTENT, 3, 6)
  }
  boxes.set(lastBox, at)
  boxes[at + 6] = moving ? 1 : 0
  return finite
}

/** The frame's phase, rebuilt in place: its boxes, its instances and the entries it walks. */
let phaseBoxes = new Float64Array(0)
const phaseInstances: VsmInstanceInvalidation[] = []
const phaseEntries: VsmLightCache[] = []

/**
 * The engine's change boxes (`worldChanged` — geometry rewritten in place, a light, a sphere buffer
 * made anew —, `residencyChanged`, released representation changes) as one invalidation phase — a
 * move's are the rows' own, on the GPU (`castInvalidation.ts`) —,
 * filtered per light like the collector's: no entry fully cached, uncached
 * or invalidated; local lights cull by radius. Each instance names its map by its word
 * (`vsmMapWord`). A moving box skips a receiver-cover map here, where the box says it moves; the
 * rows' changes skip it on the GPU (`vsmStaleMap`), the word the same.
 * One instance per box (identity rotation, world AABB); `moving` (already moving, outside the
 * static layer) = cached as dynamic, else static. Read the boxes before the plan consumes them
 * (`changes.settled()`). Returns null when the invalidation processing would skip (no cache data).
 */
export function vsmInvalidationPhaseFromShadowBoxes(
  cache: VsmCacheManager,
  source: VsmShadowBoxSource,
): VsmInvalidationPhase | null {
  if (!cache.acceptsInvalidations() || source.count === 0) return null
  // The phase is encoded in the frame that read it: its buffers are the frame's scratch.
  if (phaseBoxes.length < source.count * BOX_WORDS)
    phaseBoxes = new Float64Array(2 * source.count * BOX_WORDS)
  const boxes = phaseBoxes
  const instances = phaseInstances
  instances.length = 0
  const entries = phaseEntries
  entries.length = 0
  for (const e of cache.entries.values()) if (e.mayHoldCachedPages()) entries.push(e)
  for (let b = 0; b < source.count; b++) {
    const { min, max, moving } = source.read(b)
    const finite = writeBox(boxes, b * BOX_WORDS, min, max, moving),
      radius = length3(lastBox[3], lastBox[4], lastBox[5])
    for (const entry of entries) {
      if (moving && entry.useCover) continue
      if (finite && !entry.affectsBounds(lastBox, radius)) continue
      for (let i = 0; i < entry.mapCaches.length; i++)
        instances.push({
          firstInstance: b,
          instanceCount: 1,
          payload: vsmMapWord(entry, i),
        })
    }
  }
  if (instances.length === 0) return null
  return { batch: { instances }, boxes }
}
