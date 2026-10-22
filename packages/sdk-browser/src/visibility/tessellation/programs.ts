import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { MODE_DEPTH, MODE_ID } from '../raster/contract.ts'
import { tessLayoutEntries, type TessProgram } from './bindings.ts'
import { diceSource } from './diceWgsl.ts'
import { planSource } from './planWgsl.ts'
import { seedSource } from './seedWgsl.ts'
import { splitSource } from './splitWgsl.ts'

/** The tessellation's four modules, one for each program. */
function tessellationModules(device: GPUDevice) {
  return {
    plan: device.createShaderModule({ label: 'Trillion3D tessellation plan', code: planSource() }),
    seed: device.createShaderModule({ label: 'Trillion3D tessellation seed', code: seedSource() }),
    split: device.createShaderModule({
      label: 'Trillion3D tessellation split',
      code: splitSource(),
    }),
    dice: device.createShaderModule({ label: 'Trillion3D tessellation dice', code: diceSource() }),
  }
}

/**
 * The tessellation's pipelines, one for each kernel and none for a pass: what a pass differs by
 * travels in its uniform (`uniform.ts`). Each program has a bind group layout of its own
 * (`TESS_PROGRAMS`) and its own module; every pipeline is prepared off the frame (`ask`), which the
 * frame is held on, and compiled on a device only when a displaced surface is drawn.
 *
 * The dicing has one entry point a mode of the raster (`MODE_DEPTH`, `MODE_ID`), `dice` indexed by
 * it.
 */
export function createTessellationPrograms(device: GPUDevice) {
  const layouts: Partial<Record<TessProgram, GPUBindGroupLayout>> = {}
  const stage = (
    program: TessProgram,
    module: GPUShaderModule,
    entryPoint: string,
    constants?: Record<string, number>,
  ) => {
    const layout = (layouts[program] ??= device.createBindGroupLayout({
      entries: tessLayoutEntries(program),
    }))
    return preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module,
      entryPoint,
      constants,
      `tessellation ${entryPoint}`,
    )
  }
  const rows = groupWidthConstants(groupWidth(device.limits))
  const { plan, seed, split, dice } = tessellationModules(device)
  const stages = {
    seed: stage('seed', seed, 'tessSeed'),
    resume: stage('seed', seed, 'tessResume'),
    plan: stage('plan', plan, 'tessPlan', rows),
    visibleArgs: stage('plan', plan, 'tessVisibleArgs', rows),
    resumeArgs: stage('plan', plan, 'tessResumeArgs', rows),
    split: stage('split', split, 'tessSplit'),
    dice: [stage('dice', dice, `tessDice${MODE_DEPTH}`), stage('dice', dice, `tessDice${MODE_ID}`)],
  }
  const all = [...Object.values(stages).flat()]
  return {
    layouts,
    ...stages,
    /** Asks every pipeline, off the thread, the frame held until they are compiled; whether they
     *  all are. */
    ask() {
      for (const pipeline of all) pipeline.ask()
      return all.every((pipeline) => pipeline.ready)
    },
  }
}
