import { NO_RASTERS, type GraphRasters } from '../../../../materials/graph/graphRasters.ts'
import { COMPUTE, computeBufferEntry } from '../../../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../../../gpu/dispatch/grid.ts'
import { preparedPipeline } from '../../../deferred/fullscreen.ts'
import {
  tessLayoutEntries,
  type TessProgram,
} from '../../../../visibility/tessellation/bindings.ts'
import { planSource } from '../../../../visibility/tessellation/planWgsl.ts'
import { vsmBindGroupLayoutEntries } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { vsmRenderParamsEntry } from '../render/renderParams.ts'
import { VSM_RENDER_TARGET_FORMAT, vsmRenderRasterWgsl } from '../render/renderRasterWgsl.ts'
import {
  VSM_TESS_PROJECTION_SPECS,
  vsmTessArgsSource,
  vsmTessSeedSource,
  vsmTessSplitSource,
} from './shadowKernelsWgsl.ts'
import { vsmTessellatedVertexWgsl } from './shadowRasterWgsl.ts'
import { shadowMasks } from '../../../../visibility/shader/maskSets.ts'
import { patchVertexWpo, shadowSplitWpo } from '../../../../visibility/shader/wpoSets.ts'
import { vsmMaskedPatches } from './maskedPatches.ts'

/** The bind group layouts of the programs: the tessellation's group of each, by the name
 *  `TESS_PROGRAMS` gives it — the vertex stage's with the colour atlas where `raster` says
 *  masked —, the view pass's lists (parameters at a dynamic offset, counters and sorted records) and the maps'
 *  projections. */
function shadowLayouts(device: GPUDevice, layout: VsmLayout, raster: TessProgram) {
  const group = (program: TessProgram, visibility?: number) =>
    device.createBindGroupLayout({ entries: tessLayoutEntries(program, visibility) })
  return {
    shadowSeed: group('shadowSeed'),
    shadowSplit: group('shadowSplit'),
    plan: group('plan'),
    [raster]: group(raster, GPUShaderStage.VERTEX),
    lists: device.createBindGroupLayout({
      label: 'Trillion3D shadow tessellation lists',
      entries: [
        vsmRenderParamsEntry(0),
        computeBufferEntry(1, 'read-only-storage', COMPUTE),
        computeBufferEntry(2, 'read-only-storage', COMPUTE),
      ],
    }),
    projections: device.createBindGroupLayout({
      label: 'Trillion3D shadow tessellation projections',
      entries: vsmBindGroupLayoutEntries(VSM_TESS_PROJECTION_SPECS, COMPUTE),
    }),
  }
}

/** The render pipeline that draws the patches: `modules`' vertex stage dices them, its fragment is the
 *  casters' depth fragment, over the groups `layouts` (the page group, the raster's, the
 *  tessellation's). */
function rasterPipeline(
  device: GPUDevice,
  layouts: GPUBindGroupLayout[],
  modules: { vertex: GPUShaderModule; fragment: GPUShaderModule },
) {
  return preparedPipeline(device, {
    label: 'Trillion3D shadow tessellation raster',
    layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
    vertex: { module: modules.vertex, entryPoint: 'vsmTessellatedVs' },
    fragment: { module: modules.fragment, entryPoint: 'vsmRenderFs', targets: [] },
    // A patch's triangles face the light as the casters' do (`vsmRenderSwapped`).
    primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'back' },
    depthStencil: {
      format: VSM_RENDER_TARGET_FORMAT,
      depthWriteEnabled: false,
      depthCompare: 'always',
    },
  })
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

/**
 * THE SHADOW MAPS' TESSELLATION PIPELINES (`shadowKernelsWgsl.ts`, `shadowRasterWgsl.ts`), made once
 * a raster context — its device, its set's layout, its page group —: the seeding over a view pass's
 * records, the splitting, the arguments' kernels, the levels' plan (the image's, in a module of its
 * own here), and the render pipeline that dices the visible patches in its vertex stage, the casters'
 * depth fragment after it. Each compute program binds the tessellation's own group 0
 * (`TESS_PROGRAMS`), the view pass's lists in group 1 — one layout for all: parameters at a dynamic
 * offset, counters and records — and, for the splitting, the maps' projections in group 2. Every pipeline is
 * compiled off the frame (`ask`): until all are ready the casters draw the flat triangles they are
 * made of and the pages so drawn are not kept as cached (`vsmShadowTessellation`).
 */
export function createShadowPrograms(
  device: GPUDevice,
  layout: VsmLayout,
  pageLayout: GPUBindGroupLayout,
  raster1: GPUBindGroupLayout,
  held: GraphRasters = NO_RASTERS,
) {
  const vertexCut = vsmMaskedPatches(device)
  const rasterProgram: TessProgram = vertexCut ? 'shadowRasterMasked' : 'shadowRaster'
  // The session's graph masks cut the patches as they cut the casters; the vertex stage sees no
  // blue noise, a patch's vertex being no pixel: the cut there is plain.
  const masks = shadowMasks(held, false)
  const layouts = shadowLayouts(device, layout, rasterProgram)
  const rows = groupWidthConstants(groupWidth(device.limits))
  const module = (name: string, code: string) =>
    device.createShaderModule({ label: `Trillion3D shadow tessellation ${name}`, code })
  const stage = shadowStage.bind(null, device)
  const args = module('arguments', vsmTessArgsSource())
  const { lists } = layouts
  const stages = {
    seedArgs: stage([layouts.plan, lists], args, 'vsmTessSeedArgs', rows),
    seed: stage([layouts.shadowSeed, lists], module('seed', vsmTessSeedSource()), 'vsmTessSeed'),
    plan: stage([layouts.plan], module('plan', planSource()), 'tessPlan', rows),
    split: stage(
      [layouts.shadowSplit, lists, layouts.projections],
      module('split', vsmTessSplitSource(layout, shadowSplitWpo(held))),
      'vsmTessSplit',
    ),
    drawArgs: stage([layouts.plan, lists], args, 'vsmTessDrawArgs', rows),
  }
  const raster = rasterPipeline(device, [pageLayout, raster1, layouts[rasterProgram]], {
    vertex: module(
      'vertex',
      vsmTessellatedVertexWgsl(layout, vertexCut, masks, patchVertexWpo(held, vertexCut)),
    ),
    fragment: module('fragment', vsmRenderRasterWgsl(layout, masks)),
  })
  const all = [...Object.values(stages), raster]
  return {
    layouts,
    ...stages,
    raster,
    /** The tessellation's group the vertex stage reads, and whether it also cuts a masked row out. */
    rasterProgram,
    vertexCut,
    /** Asks every pipeline off the thread; whether they are all compiled. */
    ask() {
      for (const pipeline of all) pipeline.ask()
      return all.every((pipeline) => pipeline.ready)
    },
  }
}
export type ShadowPrograms = ReturnType<typeof createShadowPrograms>
