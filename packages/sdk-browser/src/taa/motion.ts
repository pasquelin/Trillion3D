import {
  IDENTITY_MATRIX4,
  copyMatrix4,
  invertMatrix4,
  multiplyMatrix4,
  transformAffinePoint,
  worldToRenderOrigin,
} from '../../../sdk-core/src/index.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { extendSpan } from '../../../math/src/sequence/span.ts'
import { type MatrixElements } from '../host/matrixElements.ts'
import { createDenseKeySet } from '../webgpu/cut/denseKeys.ts'

/** What a placement's motion asks of a root: its host world matrix. */
export type MotionRoot = { world: MatrixElements }

/**
 * Placement motion matrices, as the temporal pass reads them: one `mat4x4f` per root,
 * identity for a still placement, `previous · current⁻¹` — reported to the eye —
 * for one that moved since the last accumulated frame. The entry exists for every root, but
 * only those that move are rewritten, and reset to identity the frame after.
 * A CPU mirror holds the whole buffer; a frame only sends the range it touched,
 * in a single write. Told which roots moved (`noteMoved`, `../webgpu/pages/render/worldUpload.ts`),
 * a frame reads those alone — a reset takes their poses as the reference, an update compares
 * them —, never the world's placements; never told, it scans every root as it must.
 *
 * Eye anchoring follows the partition: the position the pass reprojects is relative to the
 * frame's eye, so `M` is written `T(−eye) · M · T(eye)`, of which only the translation column
 * changes — `M · (eye, 1) − eye`, computed in double before the single-precision round.
 */
export function createPlacementMotion(device: GPUDevice, roots: readonly MotionRoot[]) {
  let count = 0,
    mirror = new Float32Array(0),
    buffer: GPUBuffer | undefined,
    /** Pose of each root at the last accumulated frame. */
    previous = new Float64Array(0)
  const rememberPoses = (from = 0) => {
    for (let w = from; w < roots.length; w++) previous.set(roots[w].world.elements, w * 16)
  }
  /** One entry per root: those held keep their motion and pose, new ones start still. The arrays
   *  and the buffer are a capacity (`resized`): roots joining in place write their own entries,
   *  and the buffer is made over a logarithmic number of times. */
  const size = () => {
    const kept = count
    count = Math.max(1, roots.length)
    const next = resized(mirror, count * 16)
    previous = resized(previous, count * 16)
    for (let w = kept; w < count; w++) next.set(IDENTITY_MATRIX4, w * 16)
    if (next !== mirror || !buffer) {
      mirror = next
      buffer?.destroy()
      buffer = device.createBuffer({
        label: 'Trillion3D TAA placement motion v1',
        size: mirror.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(buffer, 0, mirror)
    } else device.queue.writeBuffer(buffer, kept * 64, mirror, kept * 16, (count - kept) * 16)
    rememberPoses(kept)
  }
  size()
  /** Roots whose entry is not identity. */
  const moved: number[] = []
  /** Roots whose pose moved since the last accumulated frame, as the poses' writer told; whether
   *  it tells at all. */
  const noted = createDenseKeySet()
  let told = false
  /** Each root `visit` reads: those told, else every one. */
  const each = (visit: (w: number) => void) => {
    if (!told) for (let w = 0; w < roots.length; w++) visit(w)
    else
      for (let i = 0; i < noted.count; i++) if (noted.list[i] < roots.length) visit(noted.list[i])
    noted.clear()
  }
  const current = new Float64Array(16),
    held = new Float64Array(16),
    motion = new Float64Array(16)
  const span = { from: count, to: -1 }
  const touch = (w: number) => extendSpan(span, w)
  /** Reset to identity what had moved, without sending it yet. */
  const clearMoved = () => {
    for (const w of moved) {
      mirror.set(IDENTITY_MATRIX4, w * 16)
      touch(w)
    }
    moved.length = 0
  }
  const flush = () => {
    if (span.to < span.from) return
    device.queue.writeBuffer(
      buffer!,
      span.from * 64,
      mirror,
      span.from * 16,
      (span.to - span.from + 1) * 16,
    )
    span.from = count
    span.to = -1
  }
  return {
    /** Replaced when roots join in place (`grow`): read at each frame, never kept. */
    get buffer() {
      return buffer!
    },
    /** Roots joined the list in place (`../placement/webgpuGrowth.ts`): the buffer follows. */
    grow() {
      if (roots.length > count) size()
    },
    /** True when at least one root carries motion this frame. */
    get moved() {
      return moved.length > 0
    },
    /**
     * On each accumulated frame: reset to identity what had moved on the previous one, then write
     * `M` for each root whose pose differs from that of the last accumulated frame, and
     * keep the pose. `scan` false says no scene matrix changed: nothing is compared.
     */
    update(eye: ArrayLike<number>, scan: boolean) {
      clearMoved()
      if (scan || told)
        each((w) => {
          const elements = roots[w].world.elements,
            at = w * 16
          if (sameElements(previous, elements, at)) return
          current.set(elements)
          invertMatrix4(current, current)
          copyMatrix4(held, previous, 0, at)
          multiplyMatrix4(motion, held, current)
          // `M · (eye, 1)` in the translation column, then `− eye` when going to single precision.
          transformAffinePoint(motion, motion, eye[0], eye[1], eye[2], 12)
          worldToRenderOrigin(mirror, motion, eye, at)
          previous.set(elements, at)
          moved.push(w)
          touch(w)
        })
      flush()
    },
    /** The roots `ranks` moved: the next frame reads them alone (`each`). */
    noteMoved(ranks: ArrayLike<number>) {
      told = true
      for (let i = 0; i < ranks.length; i++) noted.add(ranks[i])
    },
    /** The pose root `w` was last accumulated at, which its next world is compared with. */
    poseOf(w: number) {
      return previous.subarray(w * 16, w * 16 + 16)
    },
    /** History is lost: current poses become the reference, with no motion. */
    reset() {
      clearMoved()
      flush()
      each((w) => previous.set(roots[w].world.elements, w * 16))
    },
    dispose() {
      buffer!.destroy()
    },
  }
}
