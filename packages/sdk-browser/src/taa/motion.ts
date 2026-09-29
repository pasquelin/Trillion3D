import {
  IDENTITY_MATRIX4,
  copyMatrix4,
  invertMatrix4,
  multiplyMatrix4,
  transformAffinePoint,
  worldToRenderOrigin,
} from '../../../sdk-core/src/index.ts';
import { sameElements, type MatrixElements } from '../math/matrixElements.ts';

/** What a placement's motion asks of a root: its host world matrix. */
export type MotionRoot = { world: MatrixElements };

/**
 * Placement motion matrices, as the temporal pass reads them: one `mat4x4f` per root,
 * identity for a still placement, `previous · current⁻¹` — reported to the eye —
 * for one that moved since the last accumulated frame. That is what the reference keeps in
 * its instance data for dynamic objects only: here the entry exists for every root, but
 * only those that move are rewritten, and reset to identity the frame after.
 * A CPU mirror holds the whole buffer; a frame only sends the range it touched,
 * in a single write.
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
    previous = new Float64Array(0);
  const rememberPoses = (from = 0) => {
    for (let w = from; w < roots.length; w++) previous.set(roots[w].world.elements, w * 16);
  };
  /** One entry per root: those held keep their motion and pose, new ones start still. */
  const size = () => {
    const kept = count;
    count = Math.max(1, roots.length);
    const next = new Float32Array(count * 16),
      poses = new Float64Array(count * 16);
    next.set(mirror);
    for (let w = kept; w < count; w++) next.set(IDENTITY_MATRIX4, w * 16);
    poses.set(previous);
    mirror = next;
    previous = poses;
    buffer?.destroy();
    buffer = device.createBuffer({
      label: 'Trillion3D TAA placement motion v1',
      size: mirror.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, mirror);
    rememberPoses(kept);
  };
  size();
  /** Roots whose entry is not identity. */
  const moved: number[] = [];
  const current = new Float64Array(16),
    held = new Float64Array(16),
    motion = new Float64Array(16);
  let from = count,
    to = -1;
  const touch = (w: number) => {
    from = Math.min(from, w);
    to = Math.max(to, w);
  };
  /** Reset to identity what had moved, without sending it yet. */
  const clearMoved = () => {
    for (const w of moved) {
      mirror.set(IDENTITY_MATRIX4, w * 16);
      touch(w);
    }
    moved.length = 0;
  };
  const flush = () => {
    if (to < from) return;
    device.queue.writeBuffer(buffer!, from * 64, mirror, from * 16, (to - from + 1) * 16);
    from = count;
    to = -1;
  };
  return {
    /** Replaced when roots join in place (`grow`): read at each frame, never kept. */
    get buffer() {
      return buffer!;
    },
    /** Roots joined the list in place (`../placement/webgpuGrowth.ts`): the buffer follows. */
    grow() {
      if (roots.length > count) size();
    },
    /** True when at least one root carries motion this frame. */
    get moved() {
      return moved.length > 0;
    },
    /**
     * On each accumulated frame: reset to identity what had moved on the previous one, then write
     * `M` for each root whose pose differs from that of the last accumulated frame, and
     * keep the pose. `scan` false says no scene matrix changed: nothing is compared.
     */
    update(eye: ArrayLike<number>, scan: boolean) {
      clearMoved();
      if (scan)
        for (let w = 0; w < roots.length; w++) {
          const elements = roots[w].world.elements,
            at = w * 16;
          if (sameElements(previous, elements, at)) continue;
          current.set(elements);
          invertMatrix4(current, current);
          copyMatrix4(held, previous, 0, at);
          multiplyMatrix4(motion, held, current);
          // `M · (eye, 1)` in the translation column, then `− eye` when going to single precision.
          transformAffinePoint(motion, motion, eye[0], eye[1], eye[2], 12);
          worldToRenderOrigin(mirror, motion, eye, at);
          previous.set(elements, at);
          moved.push(w);
          touch(w);
        }
      flush();
    },
    /** History is lost: current poses become the reference, with no motion. */
    reset() {
      clearMoved();
      flush();
      rememberPoses();
    },
    dispose() {
      buffer!.destroy();
    },
  };
}
