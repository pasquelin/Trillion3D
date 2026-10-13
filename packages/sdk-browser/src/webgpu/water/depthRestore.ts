import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { preparedPipeline, preparedPipelines } from '../../lighting/deferred/fullscreen.ts'
import { WATER_DEPTH_RESTORE_SHADER } from './depthRestoreShader.ts'
import { waterSurfaceTargets } from './surfaceTargets.ts'
import { DEPTH_FORMAT } from '../../scene/surfaceBuffer.ts'
import { sequentialEntries, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/**
 * WebGPU forbids cropped depth texture copies. Restore texels through a fragment that reads one
 * depth layer instead; the target outside the pass's scissor is neither sampled nor written. Its
 * pipeline lists the colour targets of the pass it draws in, none of them written: the water
 * surface pass's, whose first draw it is (`frame.ts`), with or without the lobes target
 * (`restoreFor`): the plain stage's prepared here, the lobed stage's by that stage
 * (`lobedStage.ts`).
 */
export async function createWaterDepthRestore(device: GPUDevice, feedback: boolean) {
  const module = await createCheckedShaderModule(
    device,
    WATER_DEPTH_RESTORE_SHADER,
    'WATER_DEPTH_RESTORE',
  )
  const layout = device.createBindGroupLayout({
    entries: [computeTextureEntry(0, 'depth', '2d', GPUShaderStage.FRAGMENT)],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  /** The restore of the surface pass with the lobes target or without, made once each. */
  const pipelines = preparedPipelines((lobes: boolean) =>
    preparedPipeline(device, {
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: {
        module,
        entryPoint: 'restore_fs',
        targets: waterSurfaceTargets(feedback, lobes).map((target) => ({
          ...target,
          writeMask: 0,
        })),
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthCompare: 'always', depthWriteEnabled: true },
    }),
  )
  const restoreFor = (lobes: boolean) => pipelines.of(lobes)
  await restoreFor(false).prepare()
  let group: GPUBindGroup | undefined
  return {
    restoreFor,
    /** The depth the draw reads. */
    bind(source: GPUTextureView) {
      group = device.createBindGroup({ layout, entries: sequentialEntries([source]) })
    },
    /** Into an open pass, already scissored: the lobed stage's when `lobes`, prepared with it. */
    draw(pass: GPURenderPassEncoder, lobes = false) {
      pass.setPipeline(restoreFor(lobes).get())
      pass.setBindGroup(0, group!)
      pass.draw(3)
    },
    dispose() {
      group = undefined
    },
  }
}

export type WaterDepthRestore = Awaited<ReturnType<typeof createWaterDepthRestore>>
