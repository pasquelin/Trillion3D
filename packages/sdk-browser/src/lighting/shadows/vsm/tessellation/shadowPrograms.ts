import { NO_RASTERS, type GraphRasters } from '../../../../materials/graph/graphRasters.ts'
import { COMPUTE, computeBufferEntry } from '../../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../../../gpu/dispatch/grid.ts'
import {
  tessLayoutEntries,
  type TessProgram,
} from '../../../../visibility/tessellation/bindings.ts'
import { planSource } from '../../../../visibility/tessellation/planWgsl.ts'
import { vsmBindGroupLayoutEntries } from '../resources.ts'
import { vsmOcclusionEntries } from '../occlusion/occlusionPass.ts'
import type { VsmLayout } from '../layout.ts'
import { vsmRenderParamsEntry } from '../render/renderParams.ts'
import { VSM_TESS_PROJECTION_SPECS, vsmTessArgsSource, vsmTessSource } from './shadowKernelsWgsl.ts'
import { DICE_LAYERS, VSM_TESS_DICE_SPECS, vsmTessDiceWgsl } from './shadowDiceWgsl.ts'
import {
  VSM_WINDOW_BIAS_BINDING,
  VSM_WINDOW_SPECS,
  vsmWindowFillSource,
} from './shadowWindowWgsl.ts'
import { shadowPageComputeLayout } from '../../casters/pageGroup.ts'
import { shadowMasks } from '../../../../visibility/shader/maskSets.ts'
import { patchWpo, shadowSplitWpo } from '../../../../visibility/shader/wpoSets.ts'

/** The bind group layouts of the programs: the tessellation's group of each, by the name
 *  `TESS_PROGRAMS` gives it, the view pass's lists (parameters at a dynamic offset, counters and sorted records), the maps'
 *  projections, the occlusion's pyramid and kept tables (the cull's own group, `vsmOcclusionEntries`), the maps'
 *  projections, page table and uniforms the windows are filled from, and the pool's slice and uniforms the dicing writes. */
function shadowLayouts(device: GPUDevice) {
  const group = (program: TessProgram) =>
    device.createBindGroupLayout({ entries: tessLayoutEntries(program) })
  const specs = (label: string, list: Parameters<typeof vsmBindGroupLayoutEntries>[0]) =>
    device.createBindGroupLayout({
      label: `Trillion3D shadow tessellation ${label}`,
      entries: vsmBindGroupLayoutEntries(list, COMPUTE),
    })
  return {
    shadowSplit: group('shadowSplit'),
    shadowDice: group('shadowDice'),
    shadowWindow: group('shadowWindow'),
    plan: group('plan'),
    lists: device.createBindGroupLayout({
      label: 'Trillion3D shadow tessellation lists',
      entries: [
        vsmRenderParamsEntry(0),
        computeBufferEntry(1, 'read-only-storage', COMPUTE),
        computeBufferEntry(2, 'read-only-storage', COMPUTE),
      ],
    }),
    projections: specs('projections', VSM_TESS_PROJECTION_SPECS),
    windows: specs('windows', VSM_WINDOW_SPECS),
    // The atlas buffer the windows' draw bias is read from (a frame's own).
    bias: device.createBindGroupLayout({
      label: 'Trillion3D shadow tessellation bias',
      entries: [computeBufferEntry(VSM_WINDOW_BIAS_BINDING, 'read-only-storage', COMPUTE)],
    }),
    pool: specs('pool', VSM_TESS_DICE_SPECS),
    occlusion: device.createBindGroupLayout({
      label: 'Trillion3D shadow tessellation occlusion',
      entries: vsmOcclusionEntries(),
    }),
  }
}

/** A compute stage of the shadow maps' tessellation over the bind groups `groups`, asked now, off the
 *  frame (`preparedComputeStage`). */
const shadowStage = (
  device: GPUDevice,
  groups: GPUBindGroupLayout[],
  source: GPUShaderModule,
  entryPoint: string,
  constants?: Record<string, number>,
) =>
  preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: groups }),
    source,
    entryPoint,
    constants,
    `shadow tessellation ${entryPoint}`,
  )

/** The compiled pipelines of the chain, by name; `dice` one for each of `DICE_LAYERS`. */
type ShadowPipelines = Record<
  'seedArgs' | 'seed' | 'resume' | 'plan' | 'split' | 'shadowArgs' | 'windowFill',
  GPUComputePipeline
> & { dice: GPUComputePipeline[] }

/**
 * THE SHADOW MAPS' TESSELLATION PIPELINES (`shadowKernelsWgsl.ts`, `shadowWindowWgsl.ts`, `shadowDiceWgsl.ts`), made once
 * a raster context — its device, its set's layout —: the seeding over a view pass's
 * records, the splitting, the post pass's resume of the patches the main pass hid (and its arguments), the arguments' kernels,
 * the levels' plan (the image's, in a module of its own here), the kernel that fills the windows the seeding opened and the
 * software raster that dices the visible patches into the pool, an entry point for each layer of the pool. Each compute program
 * binds the tessellation's own group 0 (`TESS_PROGRAMS`), the view pass's lists in group 1 — one layout for all: parameters at a dynamic
 * offset, counters and records — and, for the seeding, the resume and the splitting, the maps' projections in group 2 and the occlusion's
 * pyramid in group 3; the dicing binds the shadow page group's compute twin (`shadowPageComputeLayout`), the tessellation's group and
 * the pool's. Every pipeline is compiled off the frame (`ask`): until all are ready the casters draw the flat triangles they are
 * made of and the pages so drawn are not kept as cached (`vsmShadowTessellation`).
 */
export function createShadowPrograms(
  device: GPUDevice,
  layout: VsmLayout,
  held: GraphRasters = NO_RASTERS,
) {
  // The session's graph masks cut the patches as they cut the casters; a patch's vertex being no
  // pixel, the cut there has no blue noise: it is plain.
  const masks = shadowMasks(held, false)
  const layouts = shadowLayouts(device)
  const rows = groupWidthConstants(groupWidth(device.limits))
  const module = (name: string, code: string) =>
    device.createShaderModule({ label: `Trillion3D shadow tessellation ${name}`, code })
  const stage = shadowStage.bind(null, device)
  const args = module('arguments', vsmTessArgsSource())
  const { lists } = layouts
  const planModule = module('plan', planSource())
  const tessModule = module('patches', vsmTessSource(layout, shadowSplitWpo(held)))
  const windowModule = module('windows', vsmWindowFillSource(layout))
  const diceModule = module('dice', vsmTessDiceWgsl(layout, masks, patchWpo(held)))
  const splitGroups = [layouts.shadowSplit, lists, layouts.projections, layouts.occlusion]
  const diceGroups = [shadowPageComputeLayout(device), layouts.shadowDice, layouts.pool]
  const stages = {
    seedArgs: stage([layouts.plan, lists], args, 'vsmTessSeedArgs', rows),
    seed: stage(splitGroups, tessModule, 'vsmTessSeed'),
    resume: stage(splitGroups, tessModule, 'vsmTessResume'),
    plan: stage([layouts.plan], planModule, 'tessPlan', rows),
    split: stage(splitGroups, tessModule, 'vsmTessSplit'),
    shadowArgs: stage([layouts.plan], args, 'vsmTessShadowArgs', rows),
    windowFill: stage(
      [layouts.shadowWindow, layouts.windows, layouts.bias],
      windowModule,
      'vsmTessWindowFill',
    ),
  }
  const dice = DICE_LAYERS.map(({ entry }) => stage(diceGroups, diceModule, entry))
  const all = [...Object.values(stages), ...dice]
  /** The pipelines, once all are compiled: the same objects for as long as the programs stand. */
  let pipelines: ShadowPipelines | undefined
  return {
    layouts,
    /** Asks the pipelines the frame needs off the thread; whether they are all compiled. */
    ask() {
      for (const pipeline of all) pipeline.ask()
      if (!all.every((pipeline) => pipeline.ready)) return false
      pipelines ??= {
        ...(Object.fromEntries(
          Object.entries(stages).map(([name, stage]) => [name, stage.get()]),
        ) as Omit<ShadowPipelines, 'dice'>),
        dice: dice.map((stage) => stage.get()!),
      }
      return true
    },
    /** The compiled pipelines: the dicing's one for each of `DICE_LAYERS`. Read after `ask` answered true. */
    get pipelines() {
      return pipelines!
    },
  }
}
export type ShadowPrograms = ReturnType<typeof createShadowPrograms>
