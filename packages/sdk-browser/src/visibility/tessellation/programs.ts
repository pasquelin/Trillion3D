import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { MODE_DEPTH, MODE_ID } from '../raster/contract.ts'
import { tessLayoutEntries, type TessProgram } from './bindings.ts'
import { diceSource } from './diceWgsl.ts'
import { hasWideAtomics } from '../../gpu/core/wideAtomics.ts'
import { diceMasks } from './diceMasks.ts'
import { NO_RASTERS, type GraphRasters } from '../../materials/graph/graphRasters.ts'
import { diceWpo, tessellationWpo } from '../shader/wpoSets.ts'
import { planSource } from './planWgsl.ts'
import { seedSource } from './seedWgsl.ts'
import { splitSource } from './splitWgsl.ts'

/** The tessellation's four modules, one for each program. */
function tessellationModules(
  device: GPUDevice,
  clipping: boolean,
  rasters: GraphRasters,
  wide: boolean,
) {
  return {
    plan: device.createShaderModule({ label: 'Trillion3D tessellation plan', code: planSource() }),
    seed: device.createShaderModule({
      label: 'Trillion3D tessellation seed',
      code: seedSource(tessellationWpo(rasters)),
    }),
    split: device.createShaderModule({
      label: 'Trillion3D tessellation split',
      code: splitSource(clipping, tessellationWpo(rasters)),
    }),
    dice: device.createShaderModule({
      label: 'Trillion3D tessellation dice',
      // The session's graph masks cut the patches' vertices (the dicing binds no blue noise), and its
      // offsets place the corners the seeding and the splitting placed alike.
      code: diceSource(diceMasks(rasters), diceWpo(rasters), wide),
    }),
  }
}

/**
 * The tessellation's pipelines, one for each kernel and none for a pass: what a pass differs by
 * travels in its uniform (`uniform.ts`). Each program has a bind group layout of its own
 * (`TESS_PROGRAMS`) and its own module; every pipeline is prepared off the frame (`ask`), which the
 * frame is held on, and compiled on a device only when a displaced surface is drawn.
 *
 * The dicing has one entry point a mode of the raster (`MODE_DEPTH`, `MODE_ID`), `dice` indexed by
 * it: a device with the 64-bit atomic maximum has the first alone.
 */
export function createTessellationPrograms(
  device: GPUDevice,
  clipping = false,
  rasters: GraphRasters = NO_RASTERS,
) {
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
  const wide = hasWideAtomics(device)
  const { plan, seed, split, dice } = tessellationModules(device, clipping, rasters, wide)
  const stages = {
    seed: stage('seed', seed, 'tessSeed'),
    resume: stage('seed', seed, 'tessResume'),
    plan: stage('plan', plan, 'tessPlan', rows),
    visibleArgs: stage('plan', plan, 'tessVisibleArgs', rows),
    resumeArgs: stage('plan', plan, 'tessResumeArgs', rows),
    split: stage('split', split, 'tessSplit'),
    dice: (wide ? [MODE_DEPTH] : [MODE_DEPTH, MODE_ID]).map((mode) =>
      stage('dice', dice, `tessDice${mode}`),
    ),
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
