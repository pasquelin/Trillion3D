import { alignUp } from '../../../packages/math/src/scalar/integers.ts'
import { sequentialEntries } from '../../../packages/sdk-browser/src/gpu/core/computeBindings.ts'
/** What a diagnostic run binds beside its output: a storage buffer holding these bytes, or any
 *  resource as it is (a texture view, a sampler). */
export type ComputeInput = ArrayBufferView<ArrayBuffer> | GPUBindingResource

/** A GPU buffer of `usage` holding `data`, written through the queue (`COPY_DST` added), at least
 *  `minBytes` long for a binding that refuses an empty or a shorter buffer. */
export function bufferHolding(
  device: GPUDevice,
  data: ArrayBuffer | ArrayBufferView<ArrayBuffer>,
  usage: GPUBufferUsageFlags,
  minBytes = 0,
) {
  const made = device.createBuffer({
    size: Math.max(minBytes, data.byteLength),
    usage: usage | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(made, 0, data)
  return made
}

export interface ComputeReadbackOptions {
  /** Bound in order in group 0, around the output's binding. */
  inputs?: ComputeInput[]
  /** The output's binding: after the inputs unless named. */
  output?: number
  /** How the output's words are read: floats unless `u32` (counters, bits). */
  words?: 'f32' | 'u32'
}

/** Runs a diagnostic compute pipeline whose one storage output is a binding of group 0 — binding
 *  0 when it reads nothing else —, its `inputs` bound around it, and returns that output's words,
 *  f32 or u32, read back once the GPU ran it. */
export async function computeReadback(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bytes: number,
  workgroups = 1,
  { inputs = [], output: at = inputs.length, words = 'f32' }: ComputeReadbackOptions = {},
) {
  const output = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const made: GPUBuffer[] = [output]
  try {
    const resource = (input: ComputeInput): GPUBindingResource => {
      if (!ArrayBuffer.isView(input)) return input
      const storage = bufferHolding(device, input, GPUBufferUsage.STORAGE)
      made.push(storage)
      return { buffer: storage }
    }
    const resources = inputs.map(resource)
    resources.splice(at, 0, { buffer: output })
    const group = groupZero(device, pipeline, resources)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(workgroups)
    pass.end()
    device.queue.submit([encoder.finish()])
    const read = await readBuffer(device, output, 0, bytes)
    return Array.from(words === 'u32' ? read : new Float32Array(read.buffer))
  } finally {
    for (const created of made) created.destroy()
  }
}

/** What a diagnostic kernel is: `module`'s `entryPoint` (`main` by default), its overrides set to
 *  `constants`, its layout the one WebGPU derives. */
export const autoKernel = (
  module: GPUShaderModule,
  entryPoint = 'main',
  constants?: Record<string, number>,
): GPUComputePipelineDescriptor => ({ layout: 'auto', compute: { module, entryPoint, constants } })

/** Group 0 of `pipeline`, `resources` bound in their order from binding 0. */
export const groupZero = (
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  resources: readonly GPUBindingResource[],
) =>
  device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: sequentialEntries(resources),
  })

/** `code`'s `main` as a compute pipeline, and its group 0 holding `out` alone: what the bench's
 *  timing proofs dispatch, in passes of their own. */
export function kernelOn(device: GPUDevice, code: string, out: GPUBuffer) {
  const pipeline = device.createComputePipeline(autoKernel(device.createShaderModule({ code })))
  return { pipeline, bind: groupZero(device, pipeline, [{ buffer: out }]) }
}

/** `bytes` of `source` from `offset`, copied once the queue's work before it ran, as words. */
export async function readBuffer(
  device: GPUDevice,
  source: GPUBuffer,
  offset: number,
  bytes: number,
) {
  const target = device.createBuffer({
    size: Math.max(4, bytes),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    const encoder = device.createCommandEncoder()
    if (bytes) encoder.copyBufferToBuffer(source, offset, target, 0, bytes)
    device.queue.submit([encoder.finish()])
    await target.mapAsync(GPUMapMode.READ)
    return new Uint32Array(target.getMappedRange().slice(0, bytes))
  } finally {
    target.destroy()
  }
}

/** Which part of a texture `readTexture` reads: one array `layer` (default 0), over `width` ×
 *  `height` texels (default the texture's own). */
export interface ReadTextureOptions {
  layer?: number
  width?: number
  height?: number
}

/** Level 0 of `texture` read back, `bytesPerTexel` a texel — any format —, its rows packed the top
 *  first: WebGPU's copy pads each row to 256 bytes, the padding dropped here. */
export async function readTexture(
  device: GPUDevice,
  texture: GPUTexture,
  bytesPerTexel: number,
  { layer = 0, width = texture.width, height = texture.height }: ReadTextureOptions = {},
) {
  const row = width * bytesPerTexel,
    pitch = alignUp(row, 256)
  const target = device.createBuffer({
    size: pitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture, origin: [0, 0, layer] },
      { buffer: target, bytesPerRow: pitch, rowsPerImage: height },
      [width, height],
    )
    device.queue.submit([encoder.finish()])
    await target.mapAsync(GPUMapMode.READ)
    const mapped = new Uint8Array(target.getMappedRange()),
      rows = new Uint8Array(row * height)
    for (let y = 0; y < height; y++) rows.set(mapped.subarray(y * pitch, y * pitch + row), y * row)
    return rows
  } finally {
    target.destroy()
  }
}
