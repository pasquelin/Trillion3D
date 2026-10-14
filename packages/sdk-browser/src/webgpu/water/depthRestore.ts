import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { preparedPipeline, preparedPipelines } from '../../lighting/deferred/fullscreen.ts'
import { RESTORE_RECT_BINDING, WATER_DEPTH_RESTORE_SHADER } from './depthRestoreShader.ts'
import { waterSurfaceTargets } from './surfaceTargets.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { VERDICT } from '../blend/verdictLayout.ts'

/**
 * WebGPU forbids cropped depth texture copies. Restore texels through a fragment that reads one
 * depth layer instead, drawn on the water rectangle's quad (`quadWgsl.ts`), indirectly: the target
 * outside the rectangle is neither sampled nor written, and nothing is drawn when no water draws.
 * Its pipeline lists the colour targets of the pass it draws in, none of them written: the water
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
      computeTextureEntry(0, 'depth', '2d', GPUShaderStage.FRAGMENT),
      computeBufferEntry(RESTORE_RECT_BINDING, 'read-only-storage', GPUShaderStage.VERTEX),
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  /** The restore of the surface pass with the lobes target or without, made once each. */
  const pipelines = preparedPipelines((lobes: boolean) =>
    preparedPipeline(device, {
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'waterQuad' },
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
  let group: GPUBindGroup | undefined, rect: GPUBuffer | undefined
  return {
    restoreFor,
    /** The depth the draw reads, and the verdict its quad and its arguments come from. */
    bind(source: GPUTextureView, verdict: GPUBuffer) {
      rect = verdict
      group = device.createBindGroup({
        layout,
        entries: sequentialEntries([source, { buffer: verdict }]),
      })
    },
    /** Into an open pass: the lobed stage's when `lobes`, prepared with it. */
    draw(pass: GPURenderPassEncoder, lobes = false) {
      pass.setPipeline(restoreFor(lobes).get())
      pass.setBindGroup(0, group!)
      pass.drawIndirect(rect!, VERDICT.quadArgs * 4)
    },
    dispose() {
      group = undefined
      rect = undefined
    },
  }
}

export type WaterDepthRestore = Awaited<ReturnType<typeof createWaterDepthRestore>>
