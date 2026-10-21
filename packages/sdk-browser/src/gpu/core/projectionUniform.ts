import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
import { fieldLayout } from './fieldLayout.ts'

/**
 * The frame's projection uniform, one table for the WGSL struct (`PROJECTION_UNI_WGSL`,
 * `boxProjectWgsl.ts`) and its writer (`packProjectionUniform`): view and view-projection, both
 * ALREADY composed with the anchor translation; the anchor in two single-precision values, with
 * the near plane; then the target size and the highest coplanar layer. The pyramid's mip table is
 * the Hi-Z levels uniform's (`hizMip`), bound beside it.
 */
export const PROJECTION_UNI = fieldLayout('Uni', [
  ['view', 'mat4x4f'],
  ['viewProj', 'mat4x4f'],
  ['anchorHigh', 'vec3f'],
  ['near', 'f32'],
  ['anchorLow', 'vec3f'],
  ['width', 'u32'],
  ['height', 'u32'],
  ['layerTop', 'u32'],
] as const)

/** What a frame tells the box projection, and nothing more: two matrices, an anchor and its
 *  integers. */
export type ProjectionFrame = {
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
  width: number
  height: number
  /** Highest coplanar layer an indirect slot names. */
  layerTop: number
}

/** Words of a frame's uniform, written into a buffer the caller holds. */
export function packProjectionUniform(
  words: Uint32Array,
  floats: Float32Array,
  frame: ProjectionFrame,
) {
  const at = PROJECTION_UNI.at
  // Anchored on the eye: the composition adds no error beyond what the kernel already bounds.
  matrixAtRenderOrigin(floats, frame.view, frame.anchor, at.view)
  matrixAtRenderOrigin(floats, frame.viewProj, frame.anchor, at.viewProj)
  // The anchor also leaves as two words: the kernel subtracts both, and the gap it gets equals
  // that of the original double to within an ulp squared.
  for (let i = 0; i < 3; i++)
    writeSplitDouble(floats, at.anchorHigh + i, at.anchorLow + i, frame.anchor[i])
  floats[at.near] = frame.near
  words[at.width] = frame.width
  words[at.height] = frame.height
  words[at.layerTop] = frame.layerTop
}

/** Uniform buffer reused from frame to frame: one writer, no allocation. */
export function createProjectionUniformWriter() {
  const words = new Uint32Array(PROJECTION_UNI.words),
    floats = new Float32Array(words.buffer)
  return (device: GPUDevice, target: GPUBuffer, frame: ProjectionFrame) => {
    packProjectionUniform(words, floats, frame)
    device.queue.writeBuffer(target, 0, words)
  }
}
