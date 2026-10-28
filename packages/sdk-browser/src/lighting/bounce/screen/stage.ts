import type { WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import type { CastKernels, KernelShape } from './kernels.ts'
import { screenStageShader } from './stageShader.ts'

/**
 * A STAGE A PASS OF THE FRAME ADDS to the screen probes' compute pass, once the rays are traced and filtered: a kernel of its own that reads the radiance
 * cache the way the scene stage does (`spCacheRead`, `spCacheGatherOwn`, `spCacheSample`), over the scene stage's group 0 and the whole reflection group (the depth pyramid, the last lit image, the views),
 * with the resources it brings in group 2. `block` is its WGSL (an entry point `entry`, its resources declared at group 2, `layout`), `encode` binds
 * group 2 and dispatches once the caller has set the pipeline.
 */
export interface ScreenProbeStage {
  /** What the stage's code depends on: two stages of one key share a compiled kernel. */
  readonly key: string
  readonly entry: string
  readonly block: WgslDecl
  readonly layout: (device: GPUDevice) => GPUBindGroupLayout
  encode(pass: GPUComputePassEncoder): void
}

/** The kernel of `stage` for the probes of `shape`, compiled off the frame: its pipeline is read once `ready`. Its group 0 is the scene stage's (`kernels.traceScene.layout`). */
export function startedScreenStage(
  device: GPUDevice,
  shape: Pick<KernelShape, 'side' | 'samples' | 'light'>,
  kernels: CastKernels,
  stage: ScreenProbeStage,
) {
  const label = `Trillion3D SCREEN_PROBE_STAGE ${stage.key}`
  const stages = startedComputeStages(
    device,
    label,
    device.createPipelineLayout({
      bindGroupLayouts: [kernels.traceScene.layout, reflectionLayout(device), stage.layout(device)],
    }),
    device.createShaderModule({ label, code: screenStageShader(shape, stage.block) }),
    [stage.entry],
  )
  return {
    get ready() {
      return stages.ready
    },
    pipeline: () => stages.pipelineOf(stage.entry),
  }
}

/** The compiled kernel of a stage (`startedScreenStage`). */
export type StartedScreenStage = ReturnType<typeof startedScreenStage>
