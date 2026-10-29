import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { PathTracingGpu } from './gpuState.ts'
import { varianceLevels } from './framePlan.ts'
import type { PathTracingPipelines } from './pipelines.ts'

/**
 * THE ERROR CHAIN'S MIPS (`ptBuildAdaptiveError`, one dispatch a level): each level of the chain that adaptive sampling reads is made from the one above it, from the first level the accumulation
 * wrote, in the image `image` of the ping-pong.
 */
export function encodeErrorMips(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PathTracingPipelines,
  gpu: PathTracingGpu,
  image: 0 | 1,
) {
  const pipeline = pipelines.error.get()
  if (!pipeline) return
  const variance = gpu.images[image].variance
  const levels = varianceLevels(gpu.size)
  const pass = encoder.beginComputePass({ label: 'Trillion3D path tracer error mips' })
  pass.setPipeline(pipeline)
  for (let level = 0; level < levels - 1; level++) {
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipelines.errorLayout,
        entries: [
          { binding: 0, resource: { buffer: gpu.errorLevels[level]! } },
          { binding: 1, resource: variance.createView({ baseMipLevel: level, mipLevelCount: 1 }) },
          {
            binding: 2,
            resource: variance.createView({ baseMipLevel: level + 1, mipLevelCount: 1 }),
          },
        ],
      }),
    )
    pass.dispatchWorkgroups(
      ceilDiv(Math.max(gpu.size[0] >> (level + 1), 1), 8),
      ceilDiv(Math.max(gpu.size[1] >> (level + 1), 1), 8),
    )
  }
  pass.end()
}

/**
 * THE NORMALS IN THE CAMERA'S SPACE (`ptConvertNormalSpace`), for the denoiser that asks for them (`pathTracingDenoiserNormalSpace` 1): the normals of the image `image` turned by the
 * rotation of the view (the transpose of the camera's world matrix `world`, column-major) into the texture beside.
 */
export function encodeNormalSpace(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PathTracingPipelines,
  gpu: PathTracingGpu,
  image: 0 | 1,
  world: ArrayLike<number>,
) {
  const pipeline = pipelines.normal.get()
  if (!pipeline) return
  const words = new ArrayBuffer(64)
  const floats = new Float32Array(words)
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++) floats[column * 4 + row] = world[row * 4 + column]!
  new Int32Array(words).set([gpu.size[0], gpu.size[1]], 12)
  device.queue.writeBuffer(gpu.normalView, 0, words)
  const pass = encoder.beginComputePass({ label: 'Trillion3D path tracer normal space' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipelines.normalLayout,
      entries: [
        { binding: 0, resource: { buffer: gpu.normalView } },
        { binding: 1, resource: gpu.images[image].normal.createView() },
        { binding: 2, resource: gpu.cameraNormals.createView() },
      ],
    }),
  )
  pass.dispatchWorkgroups(ceilDiv(gpu.size[0], 8), ceilDiv(gpu.size[1], 8))
  pass.end()
}
