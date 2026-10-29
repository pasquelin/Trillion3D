import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { HV_FORMAT } from '../liveShadingProgram.ts'
import type { FrustumGrid } from './frustumGridBuild.ts'
import type { OrthoGrid } from './orthoGridBuild.ts'
import {
  renderTransmittanceProgram,
  VG_TRANSMITTANCE_PARAMS_BYTES,
} from './renderTransmittanceWgsl.ts'

const read = (binding: number) => computeBufferEntry(binding, 'read-only-storage')

/**
 * THE PIPELINE OF THE TRANSMITTANCE THROUGH THE GRIDS for one way of finding it (`renderTransmittanceProgram`), prepared once a device and a mode
 * off the frame, with its layout: the parameters, the grids' parameters, the ortho grid's five buffers and the frustum grid's two, the view,
 * the opaque depth and the image it writes.
 */
export const transmittancePassOf = oncePerDeviceKey((device: GPUDevice, mode: number) => {
  const label = `Trillion3D heterogeneous volume grid transmittance ${mode}`
  const layout = device.createBindGroupLayout({
    label,
    entries: [
      computeUniformEntry(0),
      computeUniformEntry(1),
      read(2),
      read(3),
      read(4),
      read(5),
      read(6),
      read(7),
      read(8),
      computeUniformEntry(9),
      computeTextureEntry(10, 'depth'),
      computeStorageTextureEntry(11, HV_FORMAT),
    ],
  })
  return {
    layout,
    pipeline: preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      device.createShaderModule({ label, code: renderTransmittanceProgram(mode) }),
      'renderTransmittanceWithVoxelGrid',
      undefined,
      label,
    ),
  }
})

/**
 * Encodes the transmittance through the grids over the volumes' image `image` of `size` pixels (`RenderTransmittanceWithVoxelGrid`): a grid not built
 * is bound to `stand`, a buffer no kernel reads. `view` is the volume view's uniform (`packView`), `grids` the grids' parameters
 * (`gridParamsOf`) in a uniform buffer.
 */
export function encodeRenderTransmittance(c: {
  device: GPUDevice
  encoder: GPUCommandEncoder
  mode: number
  parameters: GPUBuffer
  grids: GPUBuffer
  view: GPUBuffer
  depth: GPUTextureView
  image: GPUTextureView
  size: readonly [number, number]
  ortho: OrthoGrid | undefined
  frustum: FrustumGrid | undefined
  stand: GPUBuffer
  maxTraceDistance: number
}) {
  const pass = transmittancePassOf(c.device, c.mode)
  const pipeline = pass.pipeline.get()
  if (!pipeline) return
  c.device.queue.writeBuffer(
    c.parameters,
    0,
    new Float32Array([c.maxTraceDistance, 0, 0, 0]).buffer.slice(0, VG_TRANSMITTANCE_PARAMS_BYTES),
  )
  const { ortho, frustum, stand } = c
  const whole = (buffer: GPUBuffer | undefined) => ({ buffer: buffer ?? stand })
  const group = c.device.createBindGroup({
    layout: pass.layout,
    entries: [
      { binding: 0, resource: { buffer: c.parameters, size: VG_TRANSMITTANCE_PARAMS_BYTES } },
      { binding: 1, resource: { buffer: c.grids } },
      { binding: 2, resource: whole(ortho?.topLevel) },
      { binding: 3, resource: whole(ortho?.indirectionGrid) },
      { binding: 4, resource: whole(ortho?.extinction) },
      { binding: 5, resource: whole(frustum?.topLevel) },
      { binding: 6, resource: whole(frustum?.extinction) },
      { binding: 7, resource: whole(ortho?.material) },
      { binding: 8, resource: whole(ortho?.majorant) },
      { binding: 9, resource: { buffer: c.view } },
      { binding: 10, resource: c.depth },
      { binding: 11, resource: c.image },
    ],
  })
  const compute = c.encoder.beginComputePass({
    label: 'Trillion3D heterogeneous volume grid transmittance',
  })
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, group)
  compute.dispatchWorkgroups(Math.ceil(c.size[0] / 8), Math.ceil(c.size[1] / 8))
  compute.end()
}
