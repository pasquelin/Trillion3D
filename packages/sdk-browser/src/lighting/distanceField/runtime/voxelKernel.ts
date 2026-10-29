import {
  VoxelKernelRefused,
  type VoxelJob,
  type VoxelKernel,
} from '../../../../../sdk-core/src/lighting/distanceFieldGpu.ts'
import {
  DISTANCE_FIELD_KERNEL_BATCH,
  DISTANCE_FIELD_KERNEL_WGSL,
  DISTANCE_FIELD_KERNEL_WORKGROUP,
} from '../../../../../sdk-core/src/lighting/distanceFieldKernel.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'

/**
 * THE COMPILER'S DISTANCE-FIELD KERNEL ON THE PAGE'S DEVICE (`asset-compiler-rust/src/distance_field/gpu.rs`, whose batches this follows):
 * the program is the compiler's own text (`distanceFieldKernel.ts`), one voxel an invocation, its value written at its own rank. A job's
 * scene is uploaded once; its voxels go in chunks, the first small, each next sized from the time the last took, so a chunk never holds the
 * device longer than a frame's share of it — the page draws on this device. Each chunk's results start all ones, which no voxel the kernel
 * measures holds: a voxel a device dropped is told from one it wrote, and measured again on the CPU (`landVoxels`).
 */

/** What one chunk should take, milliseconds: the page's frames go on between chunks. */
const TARGET_MS = 10
const WORKGROUP = DISTANCE_FIELD_KERNEL_WORKGROUP
/** A voxel's point, four floats, and its value, two words. */
const ITEM_BYTES = 16
const VALUE_BYTES = 8
/** The uniform a chunk's first invocation and count go through, padded to a `vec4`. */
const PARAMS_BYTES = 16

/** The pipelines made, one a device, compiled once. */
const pipelines = new WeakMap<GPUDevice, Promise<GPUComputePipeline>>()

async function pipelineOf(device: GPUDevice) {
  const module = await createCheckedShaderModule(
    device,
    DISTANCE_FIELD_KERNEL_WGSL,
    'distance field kernel',
  )
  return device.createComputePipelineAsync({
    label: 'distance field kernel',
    layout: 'auto',
    compute: { module, entryPoint: 'field' },
  })
}

/** The next chunk's size, in invocations, from the `count` the last held and the `took` milliseconds it took. */
const paced = (count: number, took: number, most: number) =>
  Math.min(
    most,
    Math.max(
      WORKGROUP * 16,
      Math.floor(((count / Math.max(took, 0.1)) * TARGET_MS) / WORKGROUP) * WORKGROUP,
    ),
  )

/** The kernel of `device`: measures a job's voxels and hands the results back in order. A `VoxelKernelRefused` for a scene past one
 *  binding of the device; rejects when the device fails, or with the reason of `signal` once it is aborted. */
export function createVoxelKernel(device: GPUDevice, signal?: AbortSignal): VoxelKernel {
  return async (job: VoxelJob, land) => {
    const sceneBytes = job.words.byteLength
    if (sceneBytes > device.limits.maxStorageBufferBindingSize)
      throw new VoxelKernelRefused(
        `a mesh's distance-field tree takes ${sceneBytes >> 20} MB, past one binding, ${device.limits.maxStorageBufferBindingSize >> 20} MB`,
      )
    let pipeline = pipelines.get(device)
    if (!pipeline) pipelines.set(device, (pipeline = pipelineOf(device)))
    const program = await pipeline
    const most = Math.min(
      job.count,
      DISTANCE_FIELD_KERNEL_BATCH,
      Math.floor(device.limits.maxStorageBufferBindingSize / ITEM_BYTES),
    )
    const buffer = (label: string, size: number, usage: number) =>
      device.createBuffer({ label: `distance field ${label}`, size, usage })
    const scene = buffer('scene', sceneBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
    const params = buffer('chunk', PARAMS_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
    const points = buffer(
      'points',
      most * ITEM_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    )
    const values = buffer(
      'values',
      most * VALUE_BYTES,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    )
    const read = buffer(
      'read-back',
      most * VALUE_BYTES,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    )
    const owned = [scene, params, points, values, read]
    try {
      device.queue.writeBuffer(scene, 0, job.words)
      const group = device.createBindGroup({
        layout: program.getBindGroupLayout(0),
        entries: [params, scene, points, values].map((resource, binding) => ({
          binding,
          resource: { buffer: resource },
        })),
      })
      const items = new Float32Array(most * 4)
      const unwritten = new Uint32Array(most * 2).fill(0xffffffff)
      let chunk = Math.min(most, WORKGROUP * 64)
      for (let first = 0; first < job.count;) {
        signal?.throwIfAborted()
        const count = Math.min(chunk, job.count - first)
        job.fill(first, count, items)
        device.queue.writeBuffer(points, 0, items, 0, count * 4)
        device.queue.writeBuffer(params, 0, Uint32Array.of(0, count, 0, 0))
        device.queue.writeBuffer(values, 0, unwritten, 0, count * 2)
        const encoder = device.createCommandEncoder({ label: 'distance field chunk' })
        const pass = encoder.beginComputePass()
        pass.setPipeline(program)
        pass.setBindGroup(0, group)
        pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP))
        pass.end()
        encoder.copyBufferToBuffer(values, 0, read, 0, count * VALUE_BYTES)
        const sent = performance.now()
        device.queue.submit([encoder.finish()])
        try {
          await read.mapAsync(GPUMapMode.READ, 0, count * VALUE_BYTES)
        } catch (error) {
          // The signal's abort destroys the buffer under the mapping: that is the abort, not a device failure.
          signal?.throwIfAborted()
          throw error
        }
        const results = new Uint32Array(read.getMappedRange(0, count * VALUE_BYTES).slice(0))
        read.unmap()
        chunk = paced(count, performance.now() - sent, most)
        land(first, results)
        first += count
      }
    } finally {
      owned.forEach((resource) => resource.destroy())
    }
  }
}
