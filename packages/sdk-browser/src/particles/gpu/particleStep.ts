// The particle step's pipelines (`webgpuParticles.ts`): the layouts of its groups and its three
// entries compiled.
import { hasSubgroups } from '../../gpu/core/subgroups.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { buildComputeStage } from '../../gpu/core/computeStages.ts'
import { computeBufferEntries } from '../../gpu/core/computeBindings.ts'
import { particlesWgsl } from './particlesWgsl.ts'
import { PARTICLES_PASS } from '../../diagnostic/stage/passLabels.ts'

/** The pipelines of the step's three entries (`particlesWgsl`). */
export type StepPipelines = {
  main: GPUComputePipeline
  emit: GPUComputePipeline
  bound: GPUComputePipeline
}

/** The step's buffers — its words, the staged records, the state and the partial windows —, and
 *  the bound's, which adds the window dispatch: the layouts of `main` and `emit`, and of `bound`. */
export function stepLayouts(device: GPUDevice) {
  const step: GPUBufferBindingType[] = ['uniform', 'read-only-storage', 'storage', 'storage']
  const layoutOf = (types: GPUBufferBindingType[]) =>
    device.createBindGroupLayout({ entries: computeBufferEntries(types) })
  return { layout: layoutOf(step), boundLayout: layoutOf([...step, 'storage']) }
}

/** The step's three pipelines, compiled off the thread: folded by subgroup where the device has
 *  them, through workgroup memory elsewhere. */
export async function compileStep(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  boundLayout: GPUBindGroupLayout,
): Promise<StepPipelines> {
  const module = await createCheckedShaderModule(
    device,
    particlesWgsl(hasSubgroups(device)),
    'PARTICLES',
  )
  const build = (entryPoint: string, bindGroupLayout: GPUBindGroupLayout) =>
    buildComputeStage(
      device,
      [bindGroupLayout],
      module,
      entryPoint,
      undefined,
      `${PARTICLES_PASS} ${entryPoint}`,
    )
  const [main, emit, bound] = await Promise.all([
    build('main', layout),
    build('emit', layout),
    build('bound', boundLayout),
  ])
  return { main, emit, bound }
}
