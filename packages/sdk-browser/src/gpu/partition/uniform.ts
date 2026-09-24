import {
  MAX_HIZ_LEVELS,
  UNI_ANCHOR_LOW,
  UNIFORM_U32,
  UNI_ANCHOR,
  UNI_LEVELS,
  UNI_SCALARS,
  UNI_VIEW,
  UNI_VIEW_PROJ,
  writeSplitDouble,
} from './contract.ts';
import { matrixAtRenderOrigin } from '../../../../sdk-core/src/index.ts';

/** What a frame tells the partition, and nothing more: two matrices, an anchor, seven integers. */
export type PartitionFrame = {
  /** View and view-projection elements in double precision, in WORLD coordinates. */
  view: ArrayLike<number>;
  viewProj: ArrayLike<number>;
  /**
   * Point the GPU projection reports corners relative to, in double precision: the camera pose.
   * Matrices sent to the kernel are composed with this translation, so a corner near the camera
   * no longer enters through its world coordinates — that is what keeps the error bound tight on
   * a model whose coordinates are tens of thousands.
   */
  anchor: readonly [number, number, number];
  near: number;
  rows: number;
  width: number;
  height: number;
  /** Hi-Z pyramid mips, with their offset and width; empty when there are none. */
  levels: Array<{ offset: number; width: number }>;
  /** Highest coplanar layer an indirect slot names. */
  layerTop: number;
  /** False when no pipeline can draw the tested half: the frame stays a single pass, and no
   *  row leaves the occluders. */
  hasRest: boolean;
  /** True when the view differs from the previous image's: rows the test kept while it stood
   *  still may be withdrawn from the occluders again. */
  viewMoved: boolean;
};

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
  // Anchored on the eye: the composition adds no error beyond what the kernel already bounds.
  matrixAtRenderOrigin(floats, frame.view, frame.anchor, UNI_VIEW);
  matrixAtRenderOrigin(floats, frame.viewProj, frame.anchor, UNI_VIEW_PROJ);
  // The anchor also leaves as two words: the kernel subtracts both, and the gap it gets equals
  // that of the original double to within an ulp squared.
  for (let i = 0; i < 3; i++)
    writeSplitDouble(floats, UNI_ANCHOR + i, UNI_ANCHOR_LOW + i, frame.anchor[i]);
  floats[UNI_ANCHOR + 3] = frame.near;
  floats[UNI_ANCHOR_LOW + 3] = 0;
  words[UNI_SCALARS] = rows;
  words[UNI_SCALARS + 1] = frame.width;
  words[UNI_SCALARS + 2] = frame.height;
  words[UNI_SCALARS + 3] = Math.min(frame.levels.length, MAX_HIZ_LEVELS);
  words[UNI_SCALARS + 4] = frame.layerTop;
  words[UNI_SCALARS + 5] = frame.hasRest ? 1 : 0;
  words[UNI_SCALARS + 6] = frame.viewMoved ? 1 : 0;
  words.fill(0, UNI_SCALARS + 7, UNI_LEVELS);
  for (let level = 0; level < MAX_HIZ_LEVELS; level++) {
    const mip = frame.levels[level];
    words[UNI_LEVELS + level] = mip ? mip.offset : 0;
    words[UNI_LEVELS + MAX_HIZ_LEVELS + level] = mip ? mip.width : 1;
  }
}

/** Uniform buffer reused from frame to frame: one writer, no allocation. */
export function createPartitionUniformWriter() {
  const words = new Uint32Array(UNIFORM_U32),
    floats = new Float32Array(words.buffer);
  return (device: GPUDevice, target: GPUBuffer, frame: PartitionFrame, rows: number) => {
    packPartitionUniform(words, floats, frame, rows);
    device.queue.writeBuffer(target, 0, words);
  };
}
