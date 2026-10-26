import { grantsVertexStorage } from '../../../../gpu/core/vertexTextures.ts'

/** The storage buffers a vertex stage that cuts a masked row out binds: the page group's four, the
 *  records' and the projections', `tess`, and the two atlases' page tables. */
const MASKED_VERTEX_STORAGE = 9

/** Whether the vertex stage that dices the patches may bind the colour atlas a masked row's cutout
 *  reads (`vsmTessellatedVertexWgsl`'s `vertexCut`): the device — asked for all its adapter offers
 *  of the storage buffers a stage and the vertex stage bind (`WEBGPU_REQUIRED_LIMITS`) — grants the
 *  vertex stage nine. A device held to the eight WebGPU guarantees draws a masked row's patches
 *  all the same, its cutout judged by the fragment at the point's own coordinate. */
export const vsmMaskedPatches = (device: GPUDevice) =>
  grantsVertexStorage(device, MASKED_VERTEX_STORAGE)
