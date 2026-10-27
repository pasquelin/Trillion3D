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
  vsmCoarseMarkingWgsl,
} from '../../lighting/shadows/vsm/markingWgsl.ts'
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
  vsmTessSeedSource,
  vsmTessSplitSource,
} from '../../lighting/shadows/vsm/tessellation/shadowKernelsWgsl.ts'
import { vsmTessellatedVertexWgsl } from '../../lighting/shadows/vsm/tessellation/shadowRasterWgsl.ts'
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
  const layout = vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 })
  const upper = (name: string) => name.replace(/[A-Z]/g, '_$&').toUpperCase()
  const variants: Record<string, string> = {
    // The shadowed lights' grid, pruned from the view's light grid before the marking.
    VSM_PRUNE_LIGHT_GRID: vsmPruneLightGridWgsl(),
    VSM_MARKING_RECTS: vsmPageRectInitWgsl(layout),
    VSM_MARKING_COARSE: vsmCoarseMarkingWgsl(layout),
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
    VSM_RENDER_BIN: vsmRenderBinWgsl(layout),
    VSM_RENDER_ARGS_WGSL,
    VSM_RENDER_RASTER: vsmRenderRasterWgsl(layout),
    VSM_RENDER_RASTER_MASKED: vsmRenderRasterWgsl(layout, maskGraphSets().shadow),
    VSM_RENDER_VOXEL: vsmRenderVoxelWgsl(layout),
    // The software half of the raster: plain, masked, and with the lanes' subgroup vote.
    VSM_RENDER_SOFTWARE: vsmRenderSoftwareWgsl(layout),
    VSM_RENDER_SOFTWARE_MASKED: vsmRenderSoftwareWgsl(layout, maskGraphSets().shadow),
    VSM_RENDER_SOFTWARE_SUBGROUPS: vsmRenderSoftwareWgsl(layout, undefined, undefined, true),
    // The shadow views' descent: the camera's descent kernels over the frame's lights.
    VSM_DESCENT: vsmDescentWgsl(layout),
    // The occlusion pyramid's build: the page selection, the tile levels, the top levels.
    VSM_OCCLUSION_SELECT: vsmSelectPyramidWgsl(layout),
    VSM_OCCLUSION_BUILD: vsmBuildPyramidWgsl(layout),
    VSM_OCCLUSION_TOP: vsmBuildPyramidTopWgsl(layout),
    // The displaced surfaces' patches in the shadow maps: the chain over a view pass's records, then
    // the vertex stage that dices them.
    VSM_TESSELLATION_SEED: vsmTessSeedSource(),
    VSM_TESSELLATION_SPLIT: vsmTessSplitSource(layout),
    VSM_TESSELLATION_ARGS: vsmTessArgsSource(),
    VSM_TESSELLATION_VERTEX: vsmTessellatedVertexWgsl(layout),
    VSM_TESSELLATION_VERTEX_MASKED: vsmTessellatedVertexWgsl(layout, true),
    VSM_TESSELLATION_VERTEX_MASKED_GRAPH: vsmTessellatedVertexWgsl(
      layout,
      true,
      maskGraphSets().shadowVertex,
    ),
    CAST_DIFF_WGSL,
  }
  // The projection's two passes: the suns', and the local lights' for each format of its mask.
  variants.VSM_PROJECTION_SUNS = vsmSunsProjectionWgsl(layout)
  for (const format of ['r32uint', 'rg32uint', 'rgba32uint'] as const)
    variants[`VSM_PROJECTION_LOCALS_${format.toUpperCase()}`] = vsmLocalsProjectionWgsl(
      layout,
      format,
    )
  // The marking's clears (`vsmMarkingClears`): every map's tables, and a receiver mask of the
  // suns'.
  const suns = vsmMarkingClears({ ...layout, coverMode: 'directional' })
  variants.VSM_MARKING_CLEAR = vsmResetPageTableWgsl(suns.all, layout)
  variants.VSM_MARKING_CLEAR_RECEIVER = vsmResetPageTableWgsl(suns.directionalOnly, layout)
  for (const stats of [false, true]) {
    const kernels = {
      ...vsmPhysicalPageKernels(layout, { stats }),
      ...vsmPageManagementKernels(layout),
    }
    for (const [name, kernel] of Object.entries(kernels))
      variants[`VSM_PM_${upper(name)}${stats ? '_STATS' : ''}`] = kernel.code
  }
  return variants
}
