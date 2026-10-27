/**
 * THE CPU'S CHANGE BOXES, AS SHADOW CHANGES: what no placement says — geometry rewritten in place, a
 * light, a cell's switch, a surface (`sdk-core/src/scene/light/shadow/changes.ts`). Each is a record
 * in a buffer of its own, which the stale reads after the diff's list (`castInvalidationWgsl.ts`):
 * one kernel over the same maps (`vsmCastMaps`). No light is filtered here: the kernel's range test and map cull decide
 * (`vsmStaleBoxPages`).
 *
 * A record holds its box, never less, along each world axis: a flat or long box stays flat or long.
 * Its centre rounded to an f32, `-1` after it when its casters already move, else `1`; then its
 * three half axes, the world's axes scaled by the half extent per axis, that axis's rounding added,
 * rounded up in turn (`f32Up`), and the bits of the views it stales the maps of, all: the list the
 * diff appends holds the same records (`../../casters/castChanges.ts`).
 */
import type { VsmCacheManager } from '../cacheManager.ts'
import { UNBOUNDED_EXTENT } from '../../../../deformation/halfFloat.ts'
import { boxCenter } from '../../../../../../math/src/geometry/box.ts'
import { grownLength } from '../../../../../../math/src/sequence/resized.ts'
import { f32Up } from '../../../../../../math/src/float/bits.ts'

/** Words of a box's record: its centre and moving sign, then its three half axes, the first's
 *  fourth word the views. */
export const CAST_BOX_WORDS = 16
/** The views a CPU box stales the maps of: every one. */
const EVERY_VIEW = 0xffffffff

/** The frame's boxes: `count` records in the first `count · CAST_BOX_WORDS` words of `words`. */
export interface VsmCastBoxes {
  words: Float32Array<ArrayBuffer>
  count: number
}

/** The engine's change list (`sdk-core/src/scene/light/shadow/changes.ts`,
 *  `createShadowChanges`). */
interface VsmShadowBoxSource {
  count(): number
  read(box: number): {
    min: ArrayLike<number>
    max: ArrayLike<number>
    moving: boolean
  }
}

/** The centre of the box `writeBox` writes. */
const centre = new Float64Array(3)
/** The half extents of the box `writeBox` writes. */
const extents = new Float32Array(3)

/** The frame's boxes, rebuilt in place: read in the frame that wrote them
 *  (`encodeCastInvalidation`). */
const boxes: VsmCastBoxes = { words: new Float32Array(CAST_BOX_WORDS * 8), count: 0 }
/** The same words as bits, for the views' word. */
let bits = new Uint32Array(boxes.words.buffer)

/** Writes the box `[min, max]` as the record at word `at`: its centre as an f32 and its moving
 *  sign, then its half extent per axis; the box holding the world, centred on the origin, when it
 *  is not finite, inverted, or past what f32 clip math keeps. */
function writeBox(at: number, min: ArrayLike<number>, max: ArrayLike<number>, moving: boolean) {
  const words = boxes.words
  boxCenter(centre, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  let bounded = true
  for (let a = 0; a < 3; a++) {
    const half = (max[a] - min[a]) * 0.5,
      rounded = Math.fround(centre[a]),
      extent = f32Up(half + Math.abs(centre[a] - rounded))
    bounded &&= half >= 0 && Number.isFinite(rounded) && extent < UNBOUNDED_EXTENT
    words[at + a] = rounded
    extents[a] = extent
  }
  if (!bounded) {
    words.fill(0, at, at + 3)
    extents.fill(f32Up(UNBOUNDED_EXTENT))
  }
  // The half axes along the world's axes: x at word 4, y at 8, z at 12.
  words.fill(0, at + 4, at + CAST_BOX_WORDS)
  words[at + 4] = extents[0]!
  words[at + 9] = extents[1]!
  words[at + 14] = extents[2]!
  words[at + 3] = moving ? -1 : 1
  bits[at + 7] = EVERY_VIEW
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
  const count = source.count()
  if (!cache.acceptsInvalidations() || count === 0) return null
  const words = count * CAST_BOX_WORDS
  if (boxes.words.length < words)
    boxes.words = new Float32Array(grownLength(boxes.words.length, words))
  if (bits.buffer !== boxes.words.buffer) bits = new Uint32Array(boxes.words.buffer)
  for (let b = 0; b < count; b++) {
    const box = source.read(b)
    writeBox(b * CAST_BOX_WORDS, box.min, box.max, box.moving)
  }
  boxes.count = count
  return boxes
}
