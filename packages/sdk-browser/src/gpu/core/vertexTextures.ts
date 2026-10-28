/**
 * WHETHER A VERTEX STAGE MAY READ THE COLOUR ATLAS: its page table is a storage buffer, and the vertex
 * stages that place a vertex by a graph's offset bind others besides the page group's five (the colour
 * atlas's page table among them): the count asked is ten of the storage buffers a stage is granted.
 * WebGPU guarantees eight; a device that grants ten — the
 * session asks for all its adapter offers (`WEBGPU_REQUIRED_LIMITS`) — lets an offset read a texture,
 * and one that does not draws the surface whose offset reads one unmoved, said once
 * (`refuseGraph`).
 */
const VERTEX_TEXTURE_STORAGE = 10

/** Whether `device` grants a vertex stage `count` storage buffers: the fewer of the stage's own
 *  limit (none on a device that lists none) and the shader stages' (8, WebGPU's guarantee, where the
 *  device lists none). */
function grantsVertexStorage(device: Pick<GPUDevice, 'limits'>, count: number) {
  const limits = device.limits as
    (GPUSupportedLimits & { maxStorageBuffersInVertexStage?: number }) | undefined
  const vertex = limits?.maxStorageBuffersInVertexStage ?? Infinity
  return Math.min(limits?.maxStorageBuffersPerShaderStage ?? 8, vertex) >= count
}

/** Whether `device` grants a vertex stage the storage buffers a textured offset needs. */
export const grantsVertexTextures = (device: Pick<GPUDevice, 'limits'>) =>
  grantsVertexStorage(device, VERTEX_TEXTURE_STORAGE)
