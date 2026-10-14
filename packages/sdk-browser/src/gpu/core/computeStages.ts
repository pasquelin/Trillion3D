// The engine's compute stages by entry point, built on its one way to a pipeline
// (`../../lighting/deferred/fullscreen.ts`): those prepare awaits together (`buildComputeStages`),
// those started off the frame that a frame binds once ready (`startedComputeStages`), and the
// auto-layout kernel a pass makes once a device (`autoKernel`). Every stage is one descriptor
// (`computeStage`), every prepared one made by `preparedComputeStage`.

import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import {
  buildComputePipeline,
  preparedComputePipeline,
  started,
} from '../../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from './oncePerDevice.ts'

/** The descriptor of the stage `entryPoint` of `module` on `layout`, its overrides `constants`. */
const computeStage = (
  layout: GPUPipelineLayout | 'auto',
  module: GPUShaderModule,
  entryPoint: string,
  constants?: Record<string, number>,
  label?: string,
): GPUComputePipelineDescriptor => ({
  ...(label && { label }),
  layout,
  compute: { module, entryPoint, ...(constants && { constants }) },
})

/** The stage `entryPoint` of `module` on `layout`, its overrides `constants`, prepared off the
 *  frame (`preparedComputePipeline`): every prepared compute stage of the engine. */
export const preparedComputeStage = (
  device: GPUDevice,
  layout: GPUPipelineLayout | 'auto',
  module: GPUShaderModule,
  entryPoint: string,
  constants?: Record<string, number>,
  label?: string,
) => preparedComputePipeline(device, computeStage(layout, module, entryPoint, constants, label))

/** The compute stages of one module on one layout, by entry point, compiled together off the
 *  thread: prepare never builds its pipelines one after another. The pipeline layout is made of
 *  the bind-group layouts `layouts`, group by group. */
export async function buildComputeStages<E extends string>(
  device: GPUDevice,
  layouts: readonly GPUBindGroupLayout[],
  module: GPUShaderModule,
  entryPoints: readonly E[],
  constants?: Record<string, number>,
  /** Told of each pipeline as the device hands it back, with the ms since all were asked. */
  handed?: (entryPoint: E, ms: number) => void,
) {
  const layout = device.createPipelineLayout({ bindGroupLayouts: layouts })
  const asked = cpuNow()
  const built = await Promise.all(
    entryPoints.map((entryPoint) =>
      buildComputePipeline(device, computeStage(layout, module, entryPoint, constants)).then(
        (pipeline) => (handed?.(entryPoint, msSince(asked)), pipeline),
      ),
    ),
  )
  return Object.fromEntries(entryPoints.map((entry, at) => [entry, built[at]])) as Record<
    E,
    GPUComputePipeline
  >
}

/**
 * The compute stages `entryPoints` of `module` on `layout`, each prepared off the frame and started
 * at once (`started`), labelled `${label} ${entryPoint}`: a frame binds them only once every one is
 * `ready`, and until then the work they do waits, saying so.
 */
export function startedComputeStages<E extends string>(
  device: GPUDevice,
  label: string,
  layout: GPUPipelineLayout,
  module: GPUShaderModule,
  entryPoints: readonly E[],
  constants?: Record<string, number>,
) {
  const stages = new Map(
    entryPoints.map((entryPoint) => [
      entryPoint,
      started(
        preparedComputeStage(
          device,
          layout,
          module,
          entryPoint,
          constants,
          `${label} ${entryPoint}`,
        ),
      ),
    ]),
  )
  // A compiled stage never stops being one: once all are, the answer is kept.
  let all = false
  return {
    /** The compiled pipeline of `stage`. */
    pipelineOf: (stage: E) => stages.get(stage)!.get(),
    /** Whether every stage is compiled. */
    get ready() {
      if (all) return true
      for (const stage of stages.values()) if (!stage.ready) return false
      return (all = true)
    },
  }
}

/** The kernel `entryPoint` of `code` on its own layout ('auto'), labelled `label`, prepared off the
 *  frame once a device. */
export const autoKernel = (label: string, code: string, entryPoint: string) =>
  oncePerDevice((device) =>
    preparedComputeStage(
      device,
      'auto',
      device.createShaderModule({ label, code }),
      entryPoint,
      undefined,
      label,
    ),
  )
