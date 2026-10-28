/**
 * THE SHADOW CHANGES, ON THE GPU: the list the diff of the instances' boxes appends to
 * (`castDiffWgsl.ts`) and the shadow maps' invalidation reads
 * (`../vsm/invalidation/castInvalidation.ts`). Each record is a world oriented box, as the reference
 * invalidates an instance by its oriented bounds: its centre and a sign, then its three half axes
 * and the views it stales, sixteen words — the sign `-1` for a box of casters already moving, which the static slice
 * never held, else `1`. A placement that moved, was added or removed, started or stopped casting,
 * or turned static appends the box it leaves and the box it enters; a change no placement says —
 * geometry rewritten in place, a light, residency, a surface — is no record of the list: the CPU
 * writes its box into a buffer of its own, which the invalidation reads after the list
 * (`../vsm/invalidation/castBoxes.ts`). The CPU reads no record: it keeps the list large enough for
 * what the passes it encodes may append.
 *
 * Layout: a header of four words — the records asked so far, then a flag set for good once one was
 * asked past the list —, then `records` records of `CAST_RECORD_WORDS` words. A record asked past the
 * list is not written; the flag, which a list grown since keeps, has the invalidation stale every
 * page, never fewer. The list lives across frames until an invalidation reads it
 * (`consumedCasts`): a frame that plans no shadow keeps what the diff appended for the next one.
 *
 * Beside the list, the diff's own memory (`CAST_STATE_WORDS` words a placement): the box and the
 * word each placement was last seen with, what the next diff compares it to.
 */
import { SHADOW_CHANGE_BOXES } from '../../../../../sdk-core/src/scene/light/shadow/changes.ts'
import { grownLength } from '../../../../../math/src/sequence/resized.ts'
import { clampLowWins } from '../../../../../math/src/scalar/reals.ts'
import { grownByCopy } from '../../../gpu/core/tableGrowth.ts'

/** Words of the header, and of a record (centre and sign, the three half axes of an oriented box,
 *  the views). */
export const CAST_HEADER_WORDS = 4,
  CAST_RECORD_WORDS = 16
/** Words of a placement's remembered state: its oriented box as it was (centre, half axes), its word,
 *  whether it was seen (`CAST_SEEN`), had a box (`CAST_BOXED`) and holds a swept box (`CAST_SWEPT`), a
 *  digest of its world as it was, its cache state in each view, and the swept box (the bounds, minimum
 *  then maximum, of every place it was cached as dynamic in since it last was cached as static). */
export const CAST_STATE_WORDS = 23
/** The word of a placement's state that holds its cache state in each view: bits 0..15 the views it
 *  was cached as dynamic in, bits 16..31 the views that tracked it (`castDiffWgsl.ts`). */
export const CAST_VIEWS_WORD = 10
export const CAST_SEEN = 1,
  CAST_BOXED = 2,
  CAST_SWEPT = 4
/** The words of a placement's state that hold its swept box: its minimum, then its maximum. */
export const CAST_SWEPT_MIN = 17,
  CAST_SWEPT_MAX = 20
/** Records a list holds at most: past the ceiling a frame's changes overflow into a stale of every
 *  page. It holds at least what the CPU's list of boxes holds apart (`SHADOW_CHANGE_BOXES`), which the
 *  invalidation reads beside it. */
const CAST_CEILING = 1 << 21

const castBytes = (records: number) => (CAST_HEADER_WORDS + records * CAST_RECORD_WORDS) * 4

function castBuffer(device: GPUDevice, records: number) {
  return device.createBuffer({
    label: 'Trillion3D shadow cast changes',
    size: castBytes(records),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
}

/** A list of `records` records, empty: its header zero, as a buffer is made. */
export function createCastChanges(device: GPUDevice, records = SHADOW_CHANGE_BOXES) {
  return {
    buffer: castBuffer(device, records),
    records,
    /** Records the passes encoded since the last read may have appended, at most — the diff over
     *  every placement appends past none of them, into the room the list holds —, and whether a
     *  pass was encoded at all: a list no pass appended to since its last read is not read. */
    pending: 0,
    appended: false,
    /** What the diff remembers of each placement (`ensureCastState`), and the placements it holds
     *  room for. */
    state: undefined as GPUBuffer | undefined,
    stateRoots: 0,
    /** The placements and the world writes the diff last followed (`followRoots`), and whether a
     *  word was written since: a change the diff has still to name. */
    followedRoots: 0,
    followedWrites: 0,
    owed: false,
    /** The runs the instances' state per view is still owed (`followRoots`): two after a word was
     *  written, the placements or the views moved — the run, then the one that clears the transitions
     *  it set —, and the placements and views it last followed. */
    stateOwed: 0,
    stateFollowedRoots: 0,
    stateFollowedViews: 0,
  }
}
export type CastChanges = ReturnType<typeof createCastChanges>

/**
 * Room for `more` records beside those already pending, before a pass that may append them is
 * encoded: a list too small is made again, larger, what it holds copied into it by a command
 * buffer of its own, submitted at once (`grownByCopy`) — the frame's, should it be dropped, takes
 * no unread record with it. `roots` bounds the list: past twice the placements — every one's two
 * boxes — the overflow stales every page anyway.
 */
export function reserveCasts(casts: CastChanges, device: GPUDevice, more: number, roots: number) {
  casts.pending += more
  casts.appended = true
  const ceiling = clampLowWins(2 * roots, SHADOW_CHANGE_BOXES, CAST_CEILING)
  if (casts.pending <= casts.records || casts.records >= ceiling) return
  const records = Math.min(ceiling, grownLength(casts.records, casts.pending)),
    old = casts.buffer
  const made = (casts.buffer = castBuffer(device, records))
  casts.records = records
  grownByCopy(
    device,
    [old],
    (encoder) => encoder.copyBufferToBuffer(old, 0, made, 0, old.size),
    'Trillion3D shadow cast changes growth',
  )
}

/** The list was read by the invalidation encoded into `encoder` before this: emptied after it. */
export function consumedCasts(casts: CastChanges, encoder: GPUCommandEncoder) {
  encoder.clearBuffer(casts.buffer, 0, CAST_HEADER_WORDS * 4)
  casts.pending = 0
  casts.appended = false
}

/**
 * The diff's memory held for `roots` placements: made at the first diff, grown with the roots by
 * the engine's one growth (the placements held keep their state, the new ones are unseen and
 * arrive). True when it was just made: no placement was seen yet, so the diff names none of them
 * (`castStateMadeAnew`).
 */
export function ensureCastState(casts: CastChanges, device: GPUDevice, roots: number) {
  if (casts.state && casts.stateRoots >= roots) return false
  const capacity = grownLength(casts.stateRoots, Math.max(1, roots)),
    old = casts.state,
    kept = casts.stateRoots
  const made = (casts.state = device.createBuffer({
    label: 'Trillion3D shadow cast state',
    size: capacity * CAST_STATE_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  }))
  casts.stateRoots = capacity
  if (!old) return true
  grownByCopy(
    device,
    [old],
    (encoder) => encoder.copyBufferToBuffer(old, 0, made, 0, kept * CAST_STATE_WORDS * 4),
    'Trillion3D shadow cast state growth',
  )
  return false
}

/** The pages every caster stands in, stale once: the diff's memory made anew holds no placement's
 *  box, so it cannot say which pages a placement's next change leaves. */
export function castStateMadeAnew(lights: { changes: { worldChanged: WorldChanged } }) {
  lights.changes.worldChanged(EVERYWHERE[0], EVERYWHERE[1], false)
}
type WorldChanged = (min: ArrayLike<number>, max: ArrayLike<number>, movingOnly?: boolean) => void
const EVERYWHERE = [-Infinity, Infinity].map((bound) => [bound, bound, bound])

/** Releases what the list and the memory hold, with the session. */
export function releaseCastChanges(casts: CastChanges | undefined) {
  casts?.buffer.destroy()
  casts?.state?.destroy()
}
