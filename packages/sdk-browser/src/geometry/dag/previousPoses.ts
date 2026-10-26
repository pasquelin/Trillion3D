import { isEmpty, movedList, noteMovedRank, takeMoved } from '../../placement/roots/rootMoves.ts'
import { joinedRanges, joinedSpans } from './runWrites.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import {
  createRecordTexture,
  type RecordTexture,
  type TextureMaker,
} from '../../gpu/core/recordTexture.ts'
import { WORLD_TABLE } from './worlds/worldTable.ts'

/** The previous poses' table: the worlds' layout, read by the same accessors (`worldTableWgsl`),
 *  under a name of its own. */
const PREVIOUS_POSES = { ...WORLD_TABLE, label: 'Trillion3D DAG previous poses' }
/** The fields of a placement's record that make its pose: its matrix and its exact translation. Its
 *  instance is no pose: the previous poses' copy of it is never written, nor read. */
const POSE_FIELDS = ['Matrix', 'Origin'] as const
/** Words of a pose, its fields' texels: what the engine's write rule weighs a placement at
 *  (`joinedRanges`). */
const POSE_WORDS =
  (POSE_FIELDS.reduce((sum, field) => sum + WORLD_TABLE.fields[field], 0) *
    texelBytesOf(WORLD_TABLE.format)) /
  4

/** The poses of placements `[first, first + n)` copied, in `encoder`, from the worlds' table to
 *  `table`: the two tables lay a record alike, so a piece lies at one place in both. */
function copyPoses(
  encoder: GPUCommandEncoder,
  worlds: RecordTexture,
  table: RecordTexture,
  first: number,
  n: number,
) {
  for (const field of POSE_FIELDS) {
    const texels = WORLD_TABLE.fields[field]
    worlds.copyTexels(encoder, table, field, first * texels, first * texels, n * texels)
  }
}

/** A command buffer of the copies `fill` encodes, submitted at once: behind every write the queue
 *  holds, ahead of every one asked after it. */
function submitCopies(device: GPUDevice, fill: (encoder: GPUCommandEncoder) => void) {
  const encoder = device.createCommandEncoder({ label: 'Trillion3D DAG previous poses' })
  fill(encoder)
  device.queue.submit([encoder.finish()])
}

/** The poses of the placements `taken` names — joined into runs by the engine's write rule — copied,
 *  or all of the `count` where it names none. */
function copyMoved(
  encoder: GPUCommandEncoder,
  worlds: RecordTexture,
  table: RecordTexture,
  taken: ReturnType<typeof takeMoved>,
  count: number,
) {
  if (!taken) return copyPoses(encoder, worlds, table, 0, count)
  const runs = joinedRanges(taken, taken.length, POSE_WORDS)
  for (let r = 0; r < runs; r++) {
    const first = joinedSpans[r * 2]
    copyPoses(encoder, worlds, table, first, joinedSpans[r * 2 + 1] - first + 1)
  }
}

/** The poses `older` — the kept poses of the cut this one replaces — holds of the placements both
 *  hold, taken at once as `table`'s: the poses the last drawn frame drew, never those the tables
 *  were packed at. Copied by rank: a cut replaces another only as its growth
 *  (`../../frame/prepare/cut.ts`, `adoptCut`), which keeps each placement at its rank and appends
 *  the new ones after them. */
function adoptPoses(
  device: GPUDevice,
  table: RecordTexture,
  count: number,
  older: { table: RecordTexture; count: number },
) {
  const n = Math.min(older.count, count)
  if (n <= 0) return
  submitCopies(device, (encoder) => copyPoses(encoder, older.table, table, 0, n))
}

/**
 * THE POSES THE LAST DRAWN FRAME DREW, at which every view's next main pass projects a box under its
 * previous image's matrix, against the pyramid that image built (`shader/occlusionWgsl.ts`,
 * `placedBefore`), and from which the velocity measures how far a placement moved since
 * (`../../post/taa/nearestSurfaceWgsl.ts`, `placementMotion`): a record table of the worlds' layout
 * (`worlds/worldTable.ts`), each placement's matrix and exact translation as the worlds' table held
 * them when the last drawn frame — its main view's image and those of the views drawn after it — was
 * drawn. The views of a frame draw at the one set of poses, so one table serves them all.
 *
 * The poses are copied on the GPU when the frame after a drawn one opens, before it sends a pose of
 * its own (`keep`, `../../frame/render/render.ts`), in a command buffer of their own: those of the
 * placements whose pose moved since the last copy — a host send, a parent's composition (`moved`),
 * the engine's one moved list (`../../placement/roots/rootMoves.ts`), every placement at the first
 * frame —, joined into runs by the engine's write rule (`joinedRanges`), each run's two fields a few
 * rectangles of texels (`RecordTexture.copyTexels`). Every other pose stands, as the placement did.
 * A frame held — none of its views drawn (`drawn`) — leaves the table as it is, its moves kept for
 * the copy after the next drawn frame: the table holds the poses the last image drew, never those of
 * a frame no image showed. A view drawn less often than its frame measures from these poses as every
 * other view does: the scene keeps one previous pose a placement, whichever view drew it last.
 * A placement made — the whole table, or those a growth appends (`born`) — takes its pose at once,
 * behind the writes that sent it: it was drawn at no other; a cut made anew over the placements of
 * the one it replaces takes that one's kept poses of them (`adopt`).
 */
export function createPreviousPoses(
  device: GPUDevice,
  worlds: RecordTexture,
  count: number,
  make?: TextureMaker,
) {
  const table = createRecordTexture(
    device,
    PREVIOUS_POSES,
    count,
    // Copied from too, by the cut that replaces this one (`adopt`).
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    make,
  )
  /** The placements moved since a frame last kept them: every one at first — a composition writes
   *  its roots' poses into a cut's new worlds before that cut's first image, and names none
   *  (`../../placement/compose/gpuComposeEncode.ts`). */
  const moved = movedList()
  /** Whether a view was drawn since the last copy: the first frame copies as one that follows a
   *  drawn frame. */
  let drawn = true
  /** Placements `[first, first + n)` take their pose as the worlds' table holds it, at once. */
  const born = (first: number, n: number) => {
    if (n > 0) submitCopies(device, (encoder) => copyPoses(encoder, worlds, table, first, n))
  }
  born(0, count)
  return {
    /** The record table the cut's group binds (`shader/bindings.ts`, `previous`). */
    table,
    /** The placements it holds a pose of. */
    count,
    /** The poses `older` holds of the placements both hold, taken at once (`adoptPoses`); every pose
     *  is copied again at the next keep, whichever moved since. */
    adopt(older: { table: RecordTexture; count: number }) {
      adoptPoses(device, table, count, older)
      moved.whole = true
    },
    /** Placement `w`, whose pose a send or a composition moved. */
    moved: (w: number) => noteMovedRank(moved, w),
    born,
    /** A view of this frame was drawn at the poses the worlds' table holds. */
    drawn() {
      drawn = true
    },
    /** Whether a pose moved since the last copy: the worlds' table and this one differ. */
    get moving() {
      return !isEmpty(moved)
    },
    /** The poses the last drawn frame drew, those that moved since the last copy, copied at once:
     *  before the frame that calls it sends a pose; nothing after a frame no view was drawn in. */
    keep() {
      if (!drawn) return
      drawn = false
      if (isEmpty(moved)) return
      const taken = takeMoved(moved)
      submitCopies(device, (encoder) => copyMoved(encoder, worlds, table, taken, count))
    },
  }
}
