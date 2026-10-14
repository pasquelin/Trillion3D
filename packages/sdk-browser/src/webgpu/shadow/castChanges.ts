/**
 * THE SHADOW CHANGES OF THE ROWS, ON THE GPU: the list the rows pass appends to (`castChangesWgsl.ts`)
 * and the shadow maps' invalidation reads (`../../vsm/castInvalidation.ts`). Each record is a world
 * box, its centre and its half extent, four floats: a row derived again writes the box of its sphere
 * at the pose it leaves and at the one it enters (`../../placement/rowCastWgsl.ts`); a row whose
 * shadow changed where it stands — a cutout's colour tile, a surface's alpha —, the box of its sphere
 * as it stands, the CPU naming the row alone (`nameCastRow`, `namedCasts.ts`). The CPU names no box:
 * it only keeps the list large enough for what the passes it encodes may append.
 *
 * Layout: a header of four words — the records asked so far, then a flag set for good once one was
 * asked past the list —, then `records` records, each a box's centre and its half extent, negative
 * for a box of casters already moving, which the static slice never held. A record asked past the
 * list is not written; the flag, which a list grown since keeps, has the invalidation stale every
 * page, never fewer. The list lives across frames until an
 * invalidation reads it (`consumedCasts`): a frame that plans no shadow keeps what its rows appended
 * for the next one.
 */
import { grownLength, resized } from '../../../../math/src/sequence/resized.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import type { HeldGroup } from '../../placement/composeGroups.ts'

/** Words of the header, and of a record (centre, half extent). */
export const CAST_HEADER_WORDS = 4,
  CAST_RECORD_WORDS = 4
/** Records a list holds at least, and at most: past the ceiling a frame's changes overflow into a
 *  stale of every page. */
const CAST_FLOOR = 4096,
  CAST_CEILING = 1 << 21

const castBytes = (records: number) => (records + 1) * CAST_RECORD_WORDS * 4

function castBuffer(device: GPUDevice, records: number) {
  return device.createBuffer({
    label: 'Trillion3D shadow cast changes',
    size: castBytes(records),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
}

/** A list of `records` records, empty: its header zero, as a buffer is made. */
export function createCastChanges(device: GPUDevice, records = CAST_FLOOR) {
  return {
    buffer: castBuffer(device, records),
    records,
    /** Records the passes encoded since the last read may have appended, at most — a pass over
     *  every row appends past none of them, into the room the list holds —, and whether a pass was
     *  encoded at all: a list no pass appended to since its last read is not read. */
    pending: 0,
    appended: false,
    /** The rows named since the last pass (`nameCastRow`): word 0 their count, as the kernel reads
     *  it, then the rows; their list on the GPU, the command buffer it was last encoded into and
     *  the kernel's group over it. */
    named: {
      rows: new Uint32Array(64),
      count: 0,
      buffer: undefined as GPUBuffer | undefined,
      encodedInto: undefined as GPUCommandEncoder | undefined,
      group: undefined as HeldGroup | undefined,
    },
  }
}
export type CastChanges = ReturnType<typeof createCastChanges>

/**
 * Room for `more` records beside those already pending, before a pass that may append them is
 * encoded: a list too small is made again, larger, what it holds copied into it by a command buffer
 * of its own, submitted at once — the frame's, should it be dropped, takes nothing with it. `rows`
 * bounds the list: past twice the table's rows — every row's two poses — the overflow stales every
 * page anyway.
 */
export function reserveCasts(casts: CastChanges, device: GPUDevice, more: number, rows: number) {
  casts.pending += more
  casts.appended = true
  const ceiling = clampLowWins(2 * rows, CAST_FLOOR, CAST_CEILING)
  if (casts.pending <= casts.records || casts.records >= ceiling) return
  const records = Math.min(ceiling, grownLength(casts.records, casts.pending)),
    old = casts.buffer
  casts.buffer = castBuffer(device, records)
  const encoder = device.createCommandEncoder({ label: 'Trillion3D shadow cast changes growth' })
  encoder.copyBufferToBuffer(old, 0, casts.buffer, 0, old.size)
  device.queue.submit([encoder.finish()])
  casts.records = records
  retire(device, old)
}

/** Row `row`'s shadow changed where it stands: the box of its sphere appended on the GPU, after the
 *  frame's rows pass derived it (`namedCasts.ts`). */
export function nameCastRow(casts: CastChanges, row: number) {
  const named = casts.named
  named.rows = resized(named.rows, named.count + 2)
  named.rows[++named.count] = row
  named.rows[0] = named.count
}

/** The list was read by the invalidation encoded into `encoder` before this: emptied after it. */
export function consumedCasts(casts: CastChanges, encoder: GPUCommandEncoder) {
  encoder.clearBuffer(casts.buffer, 0, CAST_HEADER_WORDS * 4)
  casts.pending = 0
  casts.appended = false
}

/** The pages every caster stands in, stale once (`../../placement/rowCastWgsl.ts`): a sphere
 *  buffer made anew holds no row's cast state, so the rows pass cannot say which pages a row's next
 *  change leaves. */
export function spheresMadeAnew(lights: { changes: { worldChanged: WorldChanged } }) {
  lights.changes.worldChanged(EVERYWHERE[0], EVERYWHERE[1], false)
}
type WorldChanged = (min: ArrayLike<number>, max: ArrayLike<number>, movingOnly?: boolean) => void
const EVERYWHERE = [-Infinity, Infinity].map((bound) => [bound, bound, bound])
