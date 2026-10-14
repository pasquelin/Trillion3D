/**
 * THE CPU'S CHANGE BOXES, AS SHADOW CHANGES: what no row says — geometry rewritten in place, a
 * light, a sphere buffer made anew, residency, released representation changes
 * (`sdk-core/src/scene/light-shadow/changes.ts`). Each is a record of the rows' list
 * (`../webgpu/shadow/castChanges.ts`), in its format, which the stale appends to the list before
 * reading it (`castInvalidationWgsl.ts`): one record format, one list, one kernel over the same
 * maps (`vsmCastMaps`) through the same filter (`vsmStaleMap`). No light is filtered here: the
 * kernel's range test and map cull decide (`vsmStaleBoxPages`).
 *
 * A record holds its box, never less: the cube of its largest half extent about its centre rounded
 * to an f32, that rounding added to the extent, rounded up in turn.
 */
import type { VsmCacheManager } from './cacheManager.ts'
import { UNBOUNDED_EXTENT } from './invalidationWgsl.ts'
import { CAST_RECORD_WORDS } from '../webgpu/shadow/castChanges.ts'
import { CAST_MIN_EXTENT } from '../webgpu/shadow/castChangesWgsl.ts'
import { boxCenter } from '../../../math/src/geometry/box.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'

/** The frame's boxes: `count` records in the first `count · CAST_RECORD_WORDS` words of `words`. */
export interface VsmCastBoxes {
  words: Float32Array<ArrayBuffer>
  count: number
}

/** The engine's change list (`sdk-core/src/scene/light-shadow/changes.ts`,
 *  `createShadowChanges`). */
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

/** The frame's boxes, rebuilt in place: read in the frame that wrote them
 *  (`encodeCastInvalidation`). */
const boxes: VsmCastBoxes = { words: new Float32Array(CAST_RECORD_WORDS * 16), count: 0 }

/** `x` rounded up to an f32: never below it, two ulps above at most. */
const f32Above = (x: number) => Math.fround(x * (1 + 2 ** -22))

/** Writes the box `[min, max]` as the record at word `at`: its centre as an f32, then its half
 *  extent, negative when its casters already move; the box holding the world, centred on the
 *  origin, when it is not finite, inverted, or past what f32 clip math keeps. */
function writeBox(at: number, min: ArrayLike<number>, max: ArrayLike<number>, moving: boolean) {
  const words = boxes.words
  boxCenter(centre, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  let extent = 0,
    bounded = true
  for (let a = 0; a < 3; a++) {
    const half = (max[a] - min[a]) * 0.5,
      rounded = Math.fround(centre[a])
    bounded &&= half >= 0 && Number.isFinite(rounded)
    extent = Math.max(extent, half + Math.abs(centre[a] - rounded))
    words[at + a] = rounded
  }
  if (!bounded || !(extent < UNBOUNDED_EXTENT)) {
    words.fill(0, at, at + 3)
    extent = UNBOUNDED_EXTENT
  }
  const e = Math.max(f32Above(extent), CAST_MIN_EXTENT)
  words[at + 3] = moving ? -e : e
}

/**
 * The engine's change boxes as shadow changes: one record each, `moving` (already moving, outside
 * the static layer) cached as dynamic, else as static. Read the boxes before the plan consumes them
 * (`changes.settled()`). Null when the cache would stale nothing (no cache data) or no box changed.
 */
export function vsmCastBoxes(
  cache: VsmCacheManager,
  source: VsmShadowBoxSource,
): VsmCastBoxes | null {
  if (!cache.acceptsInvalidations() || source.count === 0) return null
  const words = source.count * CAST_RECORD_WORDS
  if (boxes.words.length < words)
    boxes.words = new Float32Array(grownLength(boxes.words.length, words))
  for (let b = 0; b < source.count; b++) {
    const box = source.read(b)
    writeBox(b * CAST_RECORD_WORDS, box.min, box.max, box.moving)
  }
  boxes.count = source.count
  return boxes
}
