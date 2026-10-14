/**
 * THE CPU'S CHANGE BOXES, AS THE ONE STALE READS THEM (`castInvalidationWgsl.ts`, `VsmCastBox`):
 * what no row says — geometry rewritten in place, a light, a sphere buffer made anew, residency,
 * released representation changes (`sdk-core/src/scene/light-shadow/changes.ts`). They are staled
 * beside the rows' shadow changes, by the same kernel over the same maps (`vsmCastMaps`) through
 * the same filter (`vsmStaleMap`): no light is filtered here, the kernel's own range test and map
 * cull decide (`vsmStaleBoxPages`).
 */
import type { VsmCacheManager } from './cacheManager.ts'
import { UNBOUNDED_EXTENT, VSM_BOX_CASTS, VSM_BOX_MOVING } from './invalidationWgsl.ts'
import { VSM_CAST_BOX_BYTES } from './castInvalidationWgsl.ts'
import { boxCenter } from '../../../math/src/geometry/box.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'

/** Words of a box (`VsmCastBox`). */
const BOX_WORDS = VSM_CAST_BOX_BYTES / 4

/** The frame's boxes: `count` boxes in the first `count · VSM_CAST_BOX_BYTES` bytes of `words`. */
export interface VsmInvalidationPhase {
  words: Float32Array<ArrayBuffer>
  count: number
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

/** The centre of the box `writeBox` writes. */
const centre = new Float64Array(3)

/** The frame's boxes, rebuilt in place: read in the frame that wrote them (`encodeCastInvalidation`). */
const phase: VsmInvalidationPhase = { words: new Float32Array(BOX_WORDS * 16), count: 0 }
let flags = new Uint32Array(phase.words.buffer)

/** Writes the box `[min, max]` at word `at` of the phase: its centre split high and low, its flags
 *  — it casts, and its casters already move or not —, its half extent; the unbounded box, centred
 *  on the origin, when they are not finite or the box is inverted. */
function writeBox(at: number, min: ArrayLike<number>, max: ArrayLike<number>, moving: boolean) {
  const words = phase.words
  boxCenter(centre, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  let finite = true
  for (let a = 0; a < 3; a++) {
    const half = (max[a] - min[a]) * 0.5
    finite &&= Number.isFinite(centre[a]) && Number.isFinite(half) && half >= 0
    words[at + 8 + a] = half
  }
  if (!finite) {
    centre.fill(0)
    words.fill(UNBOUNDED_EXTENT, at + 8, at + 11)
  }
  for (let a = 0; a < 3; a++) writeSplitDouble(words, at + a, at + 4 + a, centre[a])
  flags[at + 3] = VSM_BOX_CASTS | (moving ? VSM_BOX_MOVING : 0)
  words[at + 7] = words[at + 11] = 0
}

/**
 * The engine's change boxes as the stale reads them: one each, `moving` (already moving, outside
 * the static layer) cached as dynamic, else as static. Read the boxes before the plan consumes them
 * (`changes.settled()`). Null when the cache would stale nothing (no cache data) or no box changed.
 */
export function vsmInvalidationPhaseFromShadowBoxes(
  cache: VsmCacheManager,
  source: VsmShadowBoxSource,
): VsmInvalidationPhase | null {
  if (!cache.acceptsInvalidations() || source.count === 0) return null
  if (phase.words.length < source.count * BOX_WORDS) {
    phase.words = new Float32Array(2 * source.count * BOX_WORDS)
    flags = new Uint32Array(phase.words.buffer)
  }
  for (let b = 0; b < source.count; b++) {
    const box = source.read(b)
    writeBox(b * BOX_WORDS, box.min, box.max, box.moving)
  }
  phase.count = source.count
  return phase
}
