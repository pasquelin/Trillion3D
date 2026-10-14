import { preparedComputePipeline, started } from './fullscreen.ts'

/**
 * The compute stages `entryPoints` of `module` on `layout`, each prepared off the frame and started
 * at once (`started`, `fullscreen.ts`), labelled `${label} ${entryPoint}`: a frame binds them only
 * once every one is `ready`, and until then the work they do waits, saying so.
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
        preparedComputePipeline(device, {
          label: `${label} ${entryPoint}`,
          layout,
          compute: { module, entryPoint, ...(constants && { constants }) },
        }),
      ),
    ]),
  )
  return {
    /** The compiled pipeline of `stage`. */
    pipelineOf: (stage: E) => stages.get(stage)!.get(),
    /** Whether every stage is compiled. */
    get ready() {
      return [...stages.values()].every((stage) => stage.ready)
    },
  }
}
