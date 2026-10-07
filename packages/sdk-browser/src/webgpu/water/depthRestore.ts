import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { WATER_DEPTH_RESTORE_SHADER } from './depthRestoreShader.ts'
import { waterSurfaceTargets } from './surfaceTargets.ts'

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
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const pipelines = new Map<boolean, PreparedPipeline<GPURenderPipeline>>()
  /** The restore of the surface pass with the lobes target or without. */
  const restoreFor = (lobes: boolean) => {
    let pipeline = pipelines.get(lobes)
    if (!pipeline) {
      const targets = waterSurfaceTargets(feedback, lobes)
      pipeline = preparedPipeline(device, {
        layout: pipelineLayout,
        vertex: { module, entryPoint: 'fullscreen' },
        fragment: {
          module,
          entryPoint: 'restore_fs',
          targets: targets.map((target) => ({ ...target, writeMask: 0 })),
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth32float', depthCompare: 'always', depthWriteEnabled: true },
      })
      pipelines.set(lobes, pipeline)
    }
    return pipeline
  }
  await restoreFor(false).prepare()
  let group: GPUBindGroup | undefined
  return {
    restoreFor,
    /** The depth the draw reads. */
    bind(source: GPUTextureView) {
      group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: source }] })
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
