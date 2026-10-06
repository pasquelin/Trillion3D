import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
import { WATER_DEPTH_RESTORE_SHADER } from './depthRestoreShader.ts'

/**
 * WebGPU forbids cropped depth texture copies. Restore texels through a fragment that reads one
 * depth layer instead; the target outside the pass's scissor is neither sampled nor written.
 * `targets`: the colour targets of the pass it draws in, none of them written — the water surface
 * pass's, whose first draw it is (`frame.ts`).
 */
export async function createWaterDepthRestore(
  device: GPUDevice,
  targets: readonly GPUColorTargetState[],
) {
  const module = await createCheckedShaderModule(
    device,
    WATER_DEPTH_RESTORE_SHADER,
    'WATER_DEPTH_RESTORE',
  )
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  const pipeline = await buildRenderPipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: {
      module,
      entryPoint: 'restore_fs',
      targets: targets.map((target) => ({ ...target, writeMask: 0 })),
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth32float', depthCompare: 'always', depthWriteEnabled: true },
  })
  let group: GPUBindGroup | undefined
  return {
    /** The depth the draw reads. */
    bind(source: GPUTextureView) {
      group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: source }] })
    },
    /** Into an open pass, already scissored. */
    draw(pass: GPURenderPassEncoder) {
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group!)
      pass.draw(3)
    },
    dispose() {
      group = undefined
    },
  }
}
