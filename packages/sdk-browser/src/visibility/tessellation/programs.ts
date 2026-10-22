import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { MODE_DEPTH, MODE_ID } from '../raster/contract.ts'
import { tessLayoutEntries, type TessProgram } from './bindings.ts'
import { diceSource } from './diceWgsl.ts'
import { planSource } from './planWgsl.ts'
import { seedSource } from './seedWgsl.ts'
import { splitSource } from './splitWgsl.ts'

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
  const layouts = {} as Record<TessProgram, GPUBindGroupLayout>
  const stage = (
    program: TessProgram,
    module: GPUShaderModule,
    entryPoint: string,
    constants?: Record<string, number>,
  ) => {
    layouts[program] ??= device.createBindGroupLayout({ entries: tessLayoutEntries(program) })
    const layout = device.createPipelineLayout({ bindGroupLayouts: [layouts[program]] })
    return preparedComputeStage(
      device,
      layout,
      module,
      entryPoint,
      constants,
      `tessellation ${entryPoint}`,
    )
  }
  const rows = groupWidthConstants(groupWidth(device.limits))
  const planModule = device.createShaderModule({
    label: 'Trillion3D tessellation plan',
    code: planSource(),
  })
  const seedModule = device.createShaderModule({
    label: 'Trillion3D tessellation seed',
    code: seedSource(),
  })
  const splitModule = device.createShaderModule({
    label: 'Trillion3D tessellation split',
    code: splitSource(),
  })
  const diceModule = device.createShaderModule({
    label: 'Trillion3D tessellation dice',
    code: diceSource(),
  })
  const stages = {
    seed: stage('seed', seedModule, 'tessSeed'),
    plan: stage('plan', planModule, 'tessPlan', rows),
    visibleArgs: stage('plan', planModule, 'tessVisibleArgs', rows),
    split: stage('split', splitModule, 'tessSplit'),
    dice: [
      stage('dice', diceModule, `tessDice${MODE_DEPTH}`),
      stage('dice', diceModule, `tessDice${MODE_ID}`),
    ],
  }
  const all = [stages.seed, stages.plan, stages.visibleArgs, stages.split, ...stages.dice]
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
export type TessellationPrograms = ReturnType<typeof createTessellationPrograms>
