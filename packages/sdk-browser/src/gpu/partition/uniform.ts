import { PARTITION_UNI } from './contract.ts'
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'

/** What a frame tells the partition, and nothing more: two matrices, an anchor, seven integers. */
export type PartitionFrame = {
  /** View and view-projection elements in double precision, in WORLD coordinates. */
  view: ArrayLike<number>
  viewProj: ArrayLike<number>
  /**
   * Point the GPU projection reports corners relative to, in double precision: the camera pose.
   * Matrices sent to the kernel are composed with this translation, so a corner near the camera
   * does not enter through its world coordinates — that is what keeps the error bound tight on
   * a model whose coordinates are tens of thousands.
   */
  anchor: readonly [number, number, number]
  near: number
  rows: number
  width: number
  height: number
  /** Highest coplanar layer an indirect slot names. */
  layerTop: number
  /** False when no pipeline can draw the tested half: the frame stays a single pass, and no
   *  row leaves the occluders. */
  hasRest: boolean
  /** True when the view differs from the previous image's: rows the test kept while it stood
   *  still may be withdrawn from the occluders again. */
  viewMoved: boolean
  /** True on the frame whose counters are sampled (`countsDue`): the kernels count only then. */
  counting: boolean
}

/**
 * Words of a frame's uniform, written into a buffer the caller holds. `rows` arrives separately:
 * the caller caps it at the buffer's capacity, and passing it this way avoids copying the whole
 * frame into a new object on every call.
 */
export function packPartitionUniform(
  words: Uint32Array,
  floats: Float32Array,
  frame: PartitionFrame,
  rows: number,
) {
  const at = PARTITION_UNI.at
  // Anchored on the eye: the composition adds no error beyond what the kernel already bounds.
  matrixAtRenderOrigin(floats, frame.view, frame.anchor, at.view)
  matrixAtRenderOrigin(floats, frame.viewProj, frame.anchor, at.viewProj)
  // The anchor also leaves as two words: the kernel subtracts both, and the gap it gets equals
  // that of the original double to within an ulp squared.
  for (let i = 0; i < 3; i++)
    writeSplitDouble(floats, at.anchorHigh + i, at.anchorLow + i, frame.anchor[i])
  floats[at.near] = frame.near
  words[at.rows] = rows
  words[at.width] = frame.width
  words[at.height] = frame.height
  words[at.layerTop] = frame.layerTop
  words[at.hasRest] = frame.hasRest ? 1 : 0
  words[at.viewMoved] = frame.viewMoved ? 1 : 0
  words[at.counting] = frame.counting ? 1 : 0
}

/** Uniform buffer reused from frame to frame: one writer, no allocation. */
export function createPartitionUniformWriter() {
  const words = new Uint32Array(PARTITION_UNI.words),
    floats = new Float32Array(words.buffer)
  return (device: GPUDevice, target: GPUBuffer, frame: PartitionFrame, rows: number) => {
    packPartitionUniform(words, floats, frame, rows)
    device.queue.writeBuffer(target, 0, words)
  }
}
