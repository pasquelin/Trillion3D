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

/**
 * THE POSES THE PREVIOUS FRAME DREW, at which every view's next main pass projects a box under its
 * previous image's matrix, against the pyramid that image built (`shader/occlusionWgsl.ts`,
 * `placedBefore`): a record table of the worlds' layout (`worlds/worldTable.ts`), each placement's
 * matrix and exact translation as the worlds' table held them when the last frame — its main view's
 * image and those of the views drawn after it — was drawn. The views of a frame draw at the one set
 * of poses, so one table serves them all.
 *
 * The poses are copied on the GPU when the next frame opens, before it sends a pose of its own
 * (`keep`, `../../frame/render/render.ts`), in a command buffer of their own: those of the
 * placements whose pose moved since the frame before — a host send, a parent's composition
 * (`moved`), the engine's one moved list (`../../placement/roots/rootMoves.ts`), every placement at
 * the first frame —, joined into runs by the engine's write rule (`joinedRanges`), each run's two
 * fields a few rectangles of texels (`RecordTexture.copyTexels`). Every other pose stands, as the
 * placement did.
 * A placement made — the whole table, or those a growth appends (`born`) — takes its pose at once,
 * behind the writes that sent it: it was drawn at no other.
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
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    make,
  )
  /** The placements moved since a frame last kept them: every one at first — a composition writes
   *  its roots' poses into a cut's new worlds before that cut's first image, and names none
   *  (`../../placement/compose/gpuComposeEncode.ts`). */
  const moved = movedList()
  /** The poses of placements `[first, first + n)` copied, in `encoder`, from the worlds' table: the
   *  two tables lay a record alike, so a piece lies at one place in both. */
  const copy = (encoder: GPUCommandEncoder, first: number, n: number) => {
    for (const field of POSE_FIELDS) {
      const texels = WORLD_TABLE.fields[field]
      worlds.copyTexels(encoder, table, field, first * texels, first * texels, n * texels)
    }
  }
  /** A command buffer of the copies `fill` encodes, submitted at once: behind every write the queue
   *  holds, ahead of every one asked after it. */
  const submit = (fill: (encoder: GPUCommandEncoder) => void) => {
    const encoder = device.createCommandEncoder({ label: 'Trillion3D DAG previous poses' })
    fill(encoder)
    device.queue.submit([encoder.finish()])
  }
  /** Placements `[first, first + n)` take their pose as the worlds' table holds it, at once. */
  const born = (first: number, n: number) => {
    if (n > 0) submit((encoder) => copy(encoder, first, n))
  }
  born(0, count)
  return {
    /** The record table the cut's group binds (`shader/bindings.ts`, `previous`). */
    table,
    /** Placement `w`, whose pose a send or a composition moved. */
    moved: (w: number) => noteMovedRank(moved, w),
    born,
    /** The poses the last frame drew, those that moved since the frame before, copied at once:
     *  before the frame that calls it sends a pose. */
    keep() {
      if (isEmpty(moved)) return
      const taken = takeMoved(moved)
      submit((encoder) => {
        if (!taken) return copy(encoder, 0, count)
        const runs = joinedRanges(taken, taken.length, POSE_WORDS)
        for (let r = 0; r < runs; r++) {
          const first = joinedSpans[r * 2]
          copy(encoder, first, joinedSpans[r * 2 + 1] - first + 1)
        }
      })
    },
  }
}
