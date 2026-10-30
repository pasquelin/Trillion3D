import { vsmAtlasCopyInWgsl } from '../../lighting/shadows/classic/atlas/atlasCopyWgsl.ts'
import { vsmAtlasRasterWgsl } from '../../lighting/shadows/classic/atlas/atlasRasterWgsl.ts'
import { clipmapVirtualSpaceWgsl } from '../../lighting/shadows/vsm/debug/clipmapVirtual.ts'
import {
  vsmVisualizeLocalsWgsl,
  vsmVisualizePerLightWgsl,
  vsmVisualizeSunsWgsl,
} from '../../lighting/shadows/vsm/projection/visualizeWgsl.ts'
import { vsmDenoiseWgsl } from '../../lighting/shadows/vsm/denoise/denoiseWgsl.ts'
import {
  vsmDenoiseMarkWgsl,
  vsmDenoiseTilesWgsl,
} from '../../lighting/shadows/vsm/denoise/denoiseTilesWgsl.ts'
import { maskGraphSets } from './engineShaders.mask.fixture.ts'
import {
  CAST_ARGS_WGSL,
  castInvalidationWgsl,
} from '../../lighting/shadows/vsm/invalidation/castInvalidationWgsl.ts'
import {
  vsmMarkingClears,
  vsmResetPageTableWgsl,
  vsmPixelPageMarkingWgsl,
  vsmPageRectInitWgsl,
  vsmClearRasterMarksWgsl,
  vsmCoarseMarkingWgsl,
  vsmDenseMarkingWgsl,
} from '../../lighting/shadows/vsm/markingWgsl.ts'
import { vsmFilterableKernels } from '../../lighting/shadows/vsm/filterableWgsl.ts'
import { vsmPageManagementKernels } from '../../lighting/shadows/vsm/pageManagementWgsl.ts'
import { vsmPhysicalPageKernels } from '../../lighting/shadows/vsm/physicalPagesWgsl.ts'
import {
  vsmLocalsProjectionWgsl,
  vsmSunsProjectionWgsl,
} from '../../lighting/shadows/vsm/projection/projectionWgsl.ts'
import { vsmRenderCullWgsl } from '../../lighting/shadows/vsm/render/renderCullWgsl.ts'
import { vsmRenderViewsWgsl } from '../../lighting/shadows/vsm/render/renderViewsWgsl.ts'
import { VSM_RENDER_ARGS_WGSL } from '../../lighting/shadows/vsm/render/renderParamsWgsl.ts'
import {
  vsmRenderCandidatesWgsl,
  vsmRenderCastersDoneWgsl,
} from '../../lighting/shadows/vsm/render/renderCandidatesWgsl.ts'
import { vsmRenderBinWgsl } from '../../lighting/shadows/vsm/render/renderBinWgsl.ts'
import { vsmRenderRasterWgsl } from '../../lighting/shadows/vsm/render/renderRasterWgsl.ts'
import { vsmRenderVoxelWgsl } from '../../lighting/shadows/vsm/render/renderVoxelWgsl.ts'
import { vsmRenderSoftwareWgsl } from '../../lighting/shadows/vsm/render/renderSoftwareWgsl.ts'
import { vsmDescentWgsl } from '../../lighting/shadows/vsm/traversal/traversalWgsl.ts'
import {
  vsmTessArgsSource,
  vsmTessSource,
} from '../../lighting/shadows/vsm/tessellation/shadowKernelsWgsl.ts'
import { vsmTessDiceWgsl } from '../../lighting/shadows/vsm/tessellation/shadowDiceWgsl.ts'
import { vsmWindowFillSource } from '../../lighting/shadows/vsm/tessellation/shadowWindowWgsl.ts'
import { vsmPerLightProjectionWgsl } from '../../lighting/shadows/vsm/projection/perLightProjectionWgsl.ts'
import { vsmPruneLightGridWgsl } from '../../lighting/shadows/vsm/projection/lightGridWgsl.ts'
import { vsmLayout } from '../../lighting/shadows/vsm/layout.ts'
import {
  vsmBuildPyramidTopWgsl,
  vsmBuildPyramidWgsl,
  vsmSelectPyramidWgsl,
} from '../../lighting/shadows/vsm/occlusion/occlusionWgsl.ts'
import { CAST_DIFF_WGSL } from '../../lighting/shadows/casters/castDiffWgsl.ts'
import {
  FROXEL_ARGS_WGSL,
  froxelBuildWgsl,
} from '../../lighting/shadows/vsm/froxel/froxelBuildWgsl.ts'
import { vsmFroxelPageMarkingWgsl } from '../../lighting/shadows/vsm/froxel/froxelMarkWgsl.ts'
import {
  VSM_THROTTLE_PROCESS_WGSL,
  VSM_THROTTLE_UPDATE_WGSL,
} from '../../lighting/shadows/vsm/throttleWgsl.ts'

/** Every virtual shadow map module, for the layout the engine makes for one sun
 *  (`../../lighting/shadows/vsm/frame/vsmEncode.ts`) at WebGPU's default binding size: the projection
 *  (one module, its kinds specialised by `VSM_TRACE_KINDS`), the page management with and without
 *  its counters. */
export function vsmVariants() {
  const layoutOptions = { coverMode: 'suns' as const, fullMapCapacity: 127, sunMapCapacity: 35 }
  const layout = vsmLayout(layoutOptions)
  const upper = (name: string) => name.replace(/[A-Z]/g, '_$&').toUpperCase()
  const variants: Record<string, string> = {
    // The shadowed lights' grid, pruned from the view's light grid before the marking.
    VSM_PRUNE_LIGHT_GRID: vsmPruneLightGridWgsl(),
    VSM_MARKING_RECTS: vsmPageRectInitWgsl(layout),
    VSM_MARKING_COARSE: vsmCoarseMarkingWgsl(layout),
    VSM_MARKING_DENSE: vsmDenseMarkingWgsl(layout),
    VSM_MARKING_PIXELS: vsmPixelPageMarkingWgsl(layout),
    VSM_MARKING_PIXELS_FRONT: vsmPixelPageMarkingWgsl(layout, true),
    VSM_MARKING_PIXELS_WATER: vsmPixelPageMarkingWgsl(layout, false, true),
    VSM_MARKING_PIXELS_FRONT_WATER: vsmPixelPageMarkingWgsl(layout, true, true),
    FROXEL_BUILD_WGSL: froxelBuildWgsl(false),
    FROXEL_WATER_BUILD_WGSL: froxelBuildWgsl(true),
    FROXEL_ARGS_WGSL,
    VSM_MARKING_FROXELS: vsmFroxelPageMarkingWgsl(layout),
    // The compute throttle's programs: the marking reading each map's own bias, the cull counting the
    // clusters in each map, and the two kernels.
    VSM_MARKING_PIXELS_THROTTLED: vsmPixelPageMarkingWgsl(layout, false, false, true),
    VSM_MARKING_FROXELS_THROTTLED: vsmFroxelPageMarkingWgsl(layout, true),
    VSM_THROTTLE_PROCESS: VSM_THROTTLE_PROCESS_WGSL,
    VSM_THROTTLE_UPDATE: VSM_THROTTLE_UPDATE_WGSL,
    VSM_INVALIDATION: castInvalidationWgsl(layout),
    CAST_ARGS_WGSL,
    VSM_RENDER_CANDIDATES: vsmRenderCandidatesWgsl(),
    VSM_RENDER_CASTERS_DONE: vsmRenderCastersDoneWgsl(),
    VSM_RENDER_VIEWS: vsmRenderViewsWgsl(layout),
    VSM_RENDER_CULL: vsmRenderCullWgsl(layout),
    VSM_RENDER_CULL_THROTTLED: vsmRenderCullWgsl(layout, true),
    // The cull marking the pages it emits drawn, on a device with ten storage buffers a stage, and
    // the bin that marks none then.
    VSM_RENDER_CULL_MARKS: vsmRenderCullWgsl(layout, false, true),
    VSM_RENDER_BIN_UNMARKING: vsmRenderBinWgsl(layout, false, true),
    // The bin placing a bin's records a workgroup at a time, and a subgroup at a time.
    VSM_RENDER_BIN: vsmRenderBinWgsl(layout),
    VSM_RENDER_BIN_SUBGROUPS: vsmRenderBinWgsl(layout, true),
    VSM_RENDER_ARGS_WGSL,
    VSM_RENDER_RASTER: vsmRenderRasterWgsl(layout),
    VSM_RENDER_RASTER_MASKED: vsmRenderRasterWgsl(layout, maskGraphSets().shadow),
    VSM_RENDER_VOXEL: vsmRenderVoxelWgsl(layout),
    // The software half of the raster: plain, masked, and with the lanes' subgroup vote, reading the
    // maps' views the bin laid and, on a device with a ninth storage buffer, their records.
    VSM_RENDER_SOFTWARE: vsmRenderSoftwareWgsl(layout),
    VSM_RENDER_SOFTWARE_MASKED: vsmRenderSoftwareWgsl(layout, maskGraphSets().shadow),
    VSM_RENDER_SOFTWARE_SUBGROUPS: vsmRenderSoftwareWgsl(layout, undefined, undefined, true),
    VSM_RENDER_SOFTWARE_BOUND: vsmRenderSoftwareWgsl(layout, undefined, undefined, false, true),
    // Both layers' records in one kernel, binding both pool slices, without and with the projection data.
    VSM_RENDER_SOFTWARE_MERGED: vsmRenderSoftwareWgsl(
      layout,
      undefined,
      undefined,
      false,
      false,
      true,
    ),
    VSM_RENDER_SOFTWARE_MERGED_BOUND: vsmRenderSoftwareWgsl(
      layout,
      maskGraphSets().shadow,
      undefined,
      false,
      true,
      true,
    ),
    VSM_RENDER_SOFTWARE_BOUND_MASKED: vsmRenderSoftwareWgsl(
      layout,
      maskGraphSets().shadow,
      undefined,
      false,
      true,
    ),
    // The shadow views' descent: the camera's descent kernels over the frame's lights.
    VSM_DESCENT: vsmDescentWgsl(layout),
    // The occlusion pyramid's build: the page selection, the tile levels, the top levels.
    VSM_OCCLUSION_SELECT: vsmSelectPyramidWgsl(layout),
    VSM_OCCLUSION_BUILD: vsmBuildPyramidWgsl(layout),
    VSM_OCCLUSION_TOP: vsmBuildPyramidTopWgsl(layout),
    // And the tile kernel writing levels 0 to 4, on a device with five storage textures a stage, with the
    // top kernel from level 4.
    VSM_OCCLUSION_BUILD_FIVE: vsmBuildPyramidWgsl(layout, 5),
    VSM_OCCLUSION_TOP_FIVE: vsmBuildPyramidTopWgsl(layout, 5),
    // The displaced surfaces' patches in the shadow maps: the chain over a view pass's records, the
    // fill of their windows, then the software raster that dices them.
    VSM_TESSELLATION: vsmTessSource(layout),
    VSM_TESSELLATION_ARGS: vsmTessArgsSource(),
    VSM_TESSELLATION_WINDOWS: vsmWindowFillSource(layout),
    VSM_TESSELLATION_DICE: vsmTessDiceWgsl(layout),
    VSM_TESSELLATION_DICE_MASKED_GRAPH: vsmTessDiceWgsl(layout, maskGraphSets().shadowVertex),
    CAST_DIFF_WGSL,
  }
  // The projection's two passes: the suns', and the local lights' for each format of its mask.
  variants.VSM_PROJECTION_SUNS = vsmSunsProjectionWgsl(layout)
  for (const format of ['r32uint', 'rg32uint', 'rgba32uint'] as const)
    variants[`VSM_PROJECTION_LOCALS_${format.toUpperCase()}`] = vsmLocalsProjectionWgsl(
      layout,
      format,
    )
  // The local lights' pass taking the longest list by the subgroups' maxima.
  variants.VSM_PROJECTION_LOCALS_SUBGROUPS = vsmLocalsProjectionWgsl(layout, 'rg32uint', true)
  // The per-light path's projection (`shadowOnePassProjection` false), with and without the subgroup vote.
  variants.VSM_PROJECTION_PER_LIGHT = vsmPerLightProjectionWgsl(layout)
  variants.VSM_PROJECTION_PER_LIGHT_SUBGROUPS = vsmPerLightProjectionWgsl(layout, true)
  // The marking's clears (`vsmMarkingClears`): every map's requests, a receiver mask of the suns', every
  // map's tables and flags; and the raster marks'.
  const suns = vsmMarkingClears({ ...layout, coverMode: 'suns' })
  variants.VSM_MARKING_CLEAR_REQUESTS = vsmResetPageTableWgsl(suns.requests.targets, layout)
  variants.VSM_MARKING_CLEAR_RECEIVER = vsmResetPageTableWgsl(suns.receiver.targets, layout)
  variants.VSM_MARKING_CLEAR_TABLES = vsmResetPageTableWgsl(suns.tables.targets, layout)
  variants.VSM_MARKING_CLEAR_RASTER_MARKS = vsmClearRasterMarksWgsl(layout)
  // The prefiltered distant shadow: its filters, and the suns' projection that reads their merged pool.
  const prefiltered = vsmLayout({ ...layoutOptions, prefilteredDistant: true })
  for (const [name, kernel] of Object.entries(vsmFilterableKernels(prefiltered)))
    variants[`VSM_PM_${upper(name)}`] = kernel.code
  variants.VSM_PROJECTION_SUNS_PREFILTERED = vsmSunsProjectionWgsl(prefiltered)
  // The classic shadows (`shadowVirtualEnable` off): the projections that filter the dense maps in place of the soft rays.
  const classic = vsmLayout({ ...layoutOptions, classic: true })
  variants.VSM_ATLAS_RASTER = vsmAtlasRasterWgsl(classic)
  variants.VSM_ATLAS_COPY_IN = vsmAtlasCopyInWgsl(classic)
  variants.VSM_CLIPMAP_VIRTUAL_SPACE = clipmapVirtualSpaceWgsl(layout)
  for (const kind of ['sun', 'light', 'r32uint', 'rg32uint', 'rgba32uint'] as const)
    variants[`VSM_DENOISE_${kind.toUpperCase()}`] = vsmDenoiseWgsl(kind)
  for (const kind of ['sun', 'light', 'r32uint', 'rg32uint', 'rgba32uint'] as const)
    variants[`VSM_DENOISE_TILES_${kind.toUpperCase()}`] = vsmDenoiseTilesWgsl(kind)
  variants.VSM_DENOISE_MARK = vsmDenoiseMarkWgsl()
  variants.VSM_VISUALIZE_SUNS = vsmVisualizeSunsWgsl(layout)
  variants.VSM_VISUALIZE_LOCALS = vsmVisualizeLocalsWgsl(layout)
  variants.VSM_VISUALIZE_PER_LIGHT = vsmVisualizePerLightWgsl(layout)
  // The pool that holds the overdraw view's slice: the raster counting into it, and the views reading it.
  const overdraw = vsmLayout({ ...layoutOptions, overdraw: true })
  variants.VSM_RENDER_RASTER_OVERDRAW = vsmRenderRasterWgsl(overdraw)
  variants.VSM_RENDER_VOXEL_OVERDRAW = vsmRenderVoxelWgsl(overdraw)
  variants.VSM_RENDER_SOFTWARE_OVERDRAW = vsmRenderSoftwareWgsl(
    overdraw,
    undefined,
    undefined,
    false,
    false,
    false,
    true,
  )
  variants.VSM_VISUALIZE_SUNS_OVERDRAW = vsmVisualizeSunsWgsl(overdraw)
  variants.VSM_VISUALIZE_LOCALS_OVERDRAW = vsmVisualizeLocalsWgsl(overdraw)
  variants.VSM_VISUALIZE_PER_LIGHT_OVERDRAW = vsmVisualizePerLightWgsl(overdraw)
  variants.VSM_PROJECTION_SUNS_CLASSIC = vsmSunsProjectionWgsl(classic)
  variants.VSM_PROJECTION_LOCALS_CLASSIC = vsmLocalsProjectionWgsl(classic, 'rg32uint')
  // The same, under the shadow the hair strands cast on the surfaces (the `hair` cut).
  variants.VSM_PROJECTION_SUNS_CLASSIC_HAIR = vsmSunsProjectionWgsl(classic, false, 'gbuffer', true)
  variants.VSM_PROJECTION_LOCALS_CLASSIC_HAIR = vsmLocalsProjectionWgsl(
    classic,
    'rg32uint',
    false,
    'gbuffer',
    false,
    true,
  )
  variants.VSM_PROJECTION_PER_LIGHT_HAIR = vsmPerLightProjectionWgsl(classic, false, true)
  // The programs the layout changes: the cull and the descent asking the request bits, the three
  // page markings, the page management.
  variants.VSM_RENDER_CULL_PREFILTERED = vsmRenderCullWgsl(prefiltered)
  variants.VSM_DESCENT_PREFILTERED = vsmDescentWgsl(prefiltered)
  variants.VSM_MARKING_COARSE_PREFILTERED = vsmCoarseMarkingWgsl(prefiltered)
  variants.VSM_MARKING_DENSE_PREFILTERED = vsmDenseMarkingWgsl(prefiltered)
  variants.VSM_MARKING_PIXELS_PREFILTERED = vsmPixelPageMarkingWgsl(prefiltered)
  variants.VSM_MARKING_FROXELS_PREFILTERED = vsmFroxelPageMarkingWgsl(prefiltered)
  for (const [pageLayout, suffix] of [
    [layout, ''],
    [prefiltered, '_PREFILTERED'],
  ] as const)
    for (const stats of [false, true]) {
      const kernels = {
        ...vsmPhysicalPageKernels(pageLayout, { stats }),
        ...vsmPageManagementKernels(pageLayout),
      }
      for (const [name, kernel] of Object.entries(kernels))
        variants[`VSM_PM_${upper(name)}${suffix}${stats ? '_STATS' : ''}`] = kernel.code
    }
  return variants
}
