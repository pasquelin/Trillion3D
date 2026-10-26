/**
 * THE FRAMES A TEMPORAL HISTORY KEEPS. Without resurrection the history is one frame, held in two
 * slots taking turns, one read as the last image's while the other is written as this one's; with
 * it, `storage` slots — two for the images just drawn, the rest for good — and a rolling index
 * that walks them:
 * - the last two images are kept in the `transient` slots, taking turns;
 * - every `period`-th image is kept in a `persistent` slot, the oldest persistent frame replaced
 *   (`persistent` slots, each holding an image `period` images apart);
 * - each image reads the last image's slot, and the oldest persistent frame's as the frame it may
 *   resurrect a pixel from (`resurrectionRolling`): the persistent slot the next stored image will
 *   overwrite, so the frame resurrected is the oldest the history holds.
 * The slot of each rolling index (`sliceOf`) puts the persistent slots in the middle of the list,
 * the transient ones at its ends.
 */
import { alignUp } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The slots of the images just drawn: they take turns, one read while the other is written. */
const TRANSIENT_SLICES = 2
/** The most frames of the history list a device can hold, even: the list is a set of textures of
 *  the history's size, so the device's array layer limit is the bound. */
const FALLBACK_MOST_SLICES = 256

/** How a history stores its frames: how many frames, and the images between two stored for good. */
export interface FrameSequence {
  /** Frames of the history: 1 without resurrection, else even and at least 4. */
  readonly storage: number
  /** Images between two stored in a persistent slot: odd, 1 to 1024. */
  readonly period: number
}

/** The sequence of a history that resurrects nothing: one frame. */
const SINGLE_FRAME: FrameSequence = Object.freeze({ storage: 1, period: 1 })

/** The slots a history of `sequence` is made of: its frames, two for a single one, which take
 *  turns. */
export const slotsOf = ({ storage }: FrameSequence) => (storage === 1 ? 2 : storage)

/**
 * The sequence a history keeps when it `resurrects` with `persistentFrames` frames stored for good
 * (rounded up to an even count) every `interval` images (made odd), within the `mostSlices` slots a
 * device lists; the single frame when it does not.
 */
export function frameSequenceOf(
  resurrects: boolean,
  persistentFrames: number,
  interval: number,
  mostSlices = FALLBACK_MOST_SLICES,
): FrameSequence {
  if (!resurrects) return SINGLE_FRAME
  const most = Math.max(4, mostSlices - (mostSlices % 2))
  const persistent = alignUp(persistentFrames, 2)
  return {
    storage: clamp(TRANSIENT_SLICES + persistent, 4, most),
    period: clamp(interval | 1, 1, 1024),
  }
}

/** The images the rolling index walks before it returns to its first. */
function rollingCount({ storage, period }: FrameSequence) {
  if (storage === 1) return 2
  if (period === 1) return storage
  return (storage - TRANSIENT_SLICES) * period
}

/** The rolling index after `rolling`. */
const nextRolling = (sequence: FrameSequence, rolling: number) =>
  (rolling + 1) % rollingCount(sequence)

/** The rolling index before `rolling`. */
const previousRolling = (sequence: FrameSequence, rolling: number) =>
  (rolling + rollingCount(sequence) - 1) % rollingCount(sequence)

/** The slot the image of rolling index `rolling` is kept in. */
function sliceOf({ storage, period }: FrameSequence, rolling: number) {
  if (storage === 1) return rolling % 2
  if (period === 1) return (rolling % 2) * (storage / 2) + (Math.floor(rolling / 2) % (storage / 2))
  if (rolling % period === 0) {
    const persistent = rolling / period
    return persistent % 2
      ? storage / 2 + Math.floor(persistent / 2)
      : storage / 2 - Math.floor(persistent / 2) - 1
  }
  return rolling % 2 ? storage - 1 : 0
}

/**
 * The rolling index of the frame an image may resurrect from, `accumulated` images in the history
 * after its last, `last`: with every image stored, the one `accumulated` images back, by pairs;
 * else the oldest persistent frame — the first once the history has not walked its whole list.
 */
function resurrectionRolling(sequence: FrameSequence, accumulated: number, last: number) {
  const count = rollingCount(sequence)
  if (sequence.storage === 1) return last
  if (sequence.period === 1)
    return (count + last - alignUp(Math.max(accumulated - 2, 0), 2)) % count
  if (accumulated < count) return 0
  return alignUp(last + sequence.period, sequence.period) % count
}

/** What a history keeps of the image in each slot, for the resurrection that reprojects by it: its
 *  camera, the scales its light and its measures are exposed by, and the grid it was drawn in. */
interface StoredFrame {
  /** Its view-projection without jitter, and its eye (`CameraImage`). */
  readonly viewProjection: Float64Array
  readonly eye: Float64Array
  /** The exposure its measures were scaled by (`taaExposure`) and the pre-exposure its light was
   *  multiplied by (`PreExposure.now`). */
  exposure: number
  preExposure: number
  /** The grid it was drawn in, `(width, height)`. */
  readonly render: Float64Array
}

const newFrame = (): StoredFrame => ({
  viewProjection: new Float64Array(16),
  eye: new Float64Array(3),
  exposure: 1,
  preExposure: 1,
  render: new Float64Array(2),
})

/** The rolling walk of a history over its frames, and what it kept of each. */
export interface FrameRing {
  sequence: FrameSequence
  /** The rolling index of the last image kept. */
  last: number
  /** The images in the history, at most a whole walk (`rollingCount`): 0 for a history that holds
   *  none. */
  accumulated: number
  /** One entry per slot (`slotsOf`). */
  frames: StoredFrame[]
}

/** A ring of the sequence `sequence`, holding no image. */
export function createFrameRing(sequence: FrameSequence = SINGLE_FRAME): FrameRing {
  return {
    sequence,
    last: 0,
    accumulated: 0,
    frames: Array.from({ length: slotsOf(sequence) }, newFrame),
  }
}

/** The slots one image reads and writes: `current` is written, `previous` read as the last image's,
 *  `resurrection` read as the frame a pixel may be resurrected from, and the rolling index the
 *  image will have once kept (`keepFrame`). `resurrects` says whether `resurrection` is a frame
 *  other than the last image's, so the resurrection can happen at all. */
export interface FrameSlices {
  readonly current: number
  readonly previous: number
  readonly resurrection: number
  readonly rolling: number
  readonly resurrects: boolean
}

/** The slots of the next image: a history that `holds` an image reads the last one's slot and
 *  the oldest persistent frame's; a history that holds none starts at rolling index 0, and reads
 *  the slot before it, which holds nothing, as both. */
export function planFrame(ring: FrameRing, holds: boolean): FrameSlices {
  const { sequence } = ring
  if (!holds || ring.accumulated === 0) {
    const before = sliceOf(sequence, previousRolling(sequence, 0))
    return {
      current: sliceOf(sequence, 0),
      previous: before,
      resurrection: before,
      rolling: 0,
      resurrects: false,
    }
  }
  const resurrection = sliceOf(sequence, resurrectionRolling(sequence, ring.accumulated, ring.last))
  const previous = sliceOf(sequence, ring.last)
  const rolling = nextRolling(sequence, ring.last)
  return {
    current: sliceOf(sequence, rolling),
    previous,
    resurrection,
    rolling,
    resurrects: resurrection !== previous,
  }
}

/** Keeps the image just drawn in the ring: the slot of `plan.current` holds its camera, its scales
 *  and its grid; an image that started the history (`holds` false) is the only one in it. */
export function keepFrame(
  ring: FrameRing,
  plan: FrameSlices,
  holds: boolean,
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
  exposure: number,
  preExposure: number,
  render: ArrayLike<number>,
) {
  const frame = ring.frames[plan.current]
  frame.viewProjection.set(viewProjection)
  frame.eye.set(eye)
  frame.exposure = exposure
  frame.preExposure = preExposure
  frame.render[0] = render[0]
  frame.render[1] = render[1]
  ring.accumulated =
    holds && ring.accumulated > 0 ? Math.min(ring.accumulated + 1, rollingCount(ring.sequence)) : 1
  ring.last = plan.rolling
}

/** The ring forgets every image, as a dropped history does. */
export function dropFrames(ring: FrameRing) {
  ring.accumulated = 0
  ring.last = 0
}
