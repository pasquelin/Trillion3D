// The scene the shadow raster draws (`render/renderPass.ts`, `VsmRenderScene`), as the engine holds
// it this frame: its casters, the main view whose detail they take, the cut's switches and the
// settings of the shadows.
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { GpuSelection } from '../../../../gpu/core/selection.ts'
import type { CutTables } from '../../../../geometry/dag/cut/cutReaders.ts'
import type { VsmRenderScene } from '../render/renderPass.ts'
import type { EngineVsm } from './engineVsm.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { readRasterSetting } from '../../../../../../sdk-core/src/contracts/rasterOptions.ts'
import { casterDrawDistance, farDropOf } from './vsmFarShadow.ts'
import { encodeCasterDecode, type CasterFeed } from '../../casters/casterFeed.ts'

/** What the casters are drawn from (`WebgpuPagesRuntime.lights`, the camera's cut), every one
 *  present. */
export interface VsmRasterCasters {
  cut: GpuSelection
  tables: CutTables
  feed: CasterFeed
  rootWords: GPUBuffer
  rootBoxes: GPUBuffer
  /** The packed pages, the clusters that may cast among them, the casters the frame holds room for
   *  (the cut's cap of candidate clusters) and the records a view pass holds room for. */
  rows: number
  candidates: number
  room: number
  records: number
  pageLayout: GPUBindGroupLayout
  pageGroup: GPUBindGroup
  /** The software half's page rows (`VsmRenderScene.pageCompute`), absent where not made. */
  pageCompute?: VsmRenderScene['pageCompute']
}

/** Whether the session holds voxel bricks: the raster's voxel tiers are drawn then
 *  (`vsmEncodeRaster`). */
export const holdsVoxels = (rt: WebgpuPagesRuntime) => {
  for (const block of rt.vis.geometryBlocks.values()) if (block.voxel) return true
  return false
}

/** The raster's scene of this frame over `casters`: the packed pages and the clusters that may cast
 *  among them, the camera, the cut's tables with its world switch, its filter and draw distances,
 *  and the settings the raster reads. */
export function vsmRasterScene(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  plan: NonNullable<EngineVsm['plan']>,
  casters: VsmRasterCasters,
  tessellation: VsmRenderScene['tessellation'],
): VsmRenderScene {
  const { cut, tables, feed } = casters
  return {
    rowCount: casters.room,
    recordCapacity: casters.records,
    packedPages: casters.rows,
    pageCount: cut.pageCount,
    // The shadow views' descent over the cut's hierarchy (`../traversal/`).
    descent: {
      tables: { ...tables.views, cold: tables.cold, previous: cut.previous },
      info: tables.descent,
    },
    info: cut.info,
    rootWords: casters.rootWords,
    rootBoxes: casters.rootBoxes,
    casters: feed.list,
    edges: cut.edges,
    decode: (pass, which) => encodeCasterDecode(pass, feed, which),
    pageLayout: casters.pageLayout,
    pageGroup: casters.pageGroup,
    pageCompute: casters.pageCompute,
    rasters: rt.vis.rasters,
    voxels: holdsVoxels(rt),
    tessellation,
    // The shadows' level of detail: the cut's pixels per edge times two to the shadows' bias
    // (`shadowGeometryLodBias`), over the streaming quality scale
    // (`../../../../geometry/residency/poolPressure.ts`) — coarser shadows where residency is under
    // pressure, as the main view.
    camera: {
      eye: cam.eye,
      view: cam.view,
      threshold:
        (rt.run.gate.pixelError * 2 ** readShadowSetting(rt, 'shadowGeometryLodBias')) /
        rt.services.residency.qualityScale,
    },
    world: castersWorld(rt, cut, tables),
    // The draw distances the objects name: an object out of its own casts nothing.
    drawDistance: casterDrawDistance(rt, cut),
    ...rasterSettings(rt, plan),
  }
}

/** The cut's tables the casters are judged by: a cluster the view does not draw casts nothing
 *  (`worldDraws`); its frame words, where the objects' draw distances lie, a cut without a world
 *  has as well. */
function castersWorld(
  rt: WebgpuPagesRuntime,
  cut: GpuSelection,
  tables: CutTables,
): VsmRenderScene['world'] {
  return {
    cold: tables.cold,
    frames: tables.views.frames,
    clusters: tables.clusters,
    worlds: tables.views.worlds,
    // The poses the previous image drew: the occlusion's first cull tests a caster there.
    previous: cut.previous,
    links: cut.cellStates?.links,
    // The main view's filter: a hidden object casts nothing into its shadows.
    filter: cut.holdFilter(rt.run.selectionUniforms.filter),
  }
}

/** What the raster reads of the settings: the software raster's edge, the suns' far-shadow test, the
 *  lights' view passes and the pyramid's build. */
function rasterSettings(rt: WebgpuPagesRuntime, plan: NonNullable<EngineVsm['plan']>) {
  return {
    // The camera's rule picks each cluster's raster in each map's view: past this edge in the map's
    // pixels the hardware raster's, every
    // cluster the hardware's with the software raster off.
    hardwareEdge: readRasterSetting(rt, 'softwareRaster')
      ? readRasterSetting(rt, 'hardwareRasterEdgePixels')
      : 0,
    // The suns' far-shadow test: the world's merged shells, or every caster, and the distance past
    // which no view of the frame takes a caster (`vsmFarShadowSkipped`).
    farMeshes: readShadowSetting(rt, 'farShadowCullsAllMeshes'),
    farDrop: farDropOf(plan.lights),
    // The lights whose views pass a pass's limit are drawn in several passes (`vsmViewPasses`).
    multipassViews: readShadowSetting(rt, 'shadowMultipassViews'),
    // The occlusion pyramid built over every held page, or over the pages drawn.
    occlusionFullUpdate: readShadowSetting(rt, 'shadowOcclusionFullUpdate'),
  }
}
