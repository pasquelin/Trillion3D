import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../../lighting/deferred/fullscreen.ts'

/**
 * THE PIPELINES OF THE SKY LIGHT'S PASSES, each asked at once, off the frame
 * (`PreparedPipeline.ask`), its compilation's failure handed to `failed`: a fullscreen draw into
 * one colour target, and a compute stage over one bind group.
 */
export function askedPipelines(device: GPUDevice, failed: (error: unknown) => void) {
  return {
    draw(
      module: GPUShaderModule,
      groups: GPUBindGroupLayout[],
      entry: string,
      target: GPUColorTargetState,
      label: string,
    ) {
      const pipeline = preparedPipeline(
        device,
        fullscreenDescriptor(device, module, groups, entry, [target], label),
      ).ask()
      pipeline.prepare().catch(failed)
      return pipeline
    },
    compute(module: GPUShaderModule, group: GPUBindGroupLayout, entry: string, label: string) {
      const pipeline = preparedComputeStage(
        device,
        device.createPipelineLayout({ bindGroupLayouts: [group] }),
        module,
        entry,
        undefined,
        label,
      ).ask()
      pipeline.prepare().catch(failed)
      return pipeline
    },
  }
}
