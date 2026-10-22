// The scene the shadow raster draws (`render/renderPass.ts`, `VsmRenderScene`), as the engine holds
// it this frame: its caster rows, the main view whose detail the casters take, the cut's switches
// and the settings of the shadows.
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { focalPixels } from '../../../../../../math/src/projection/camera.ts'
import type { VsmRenderScene } from '../render/renderPass.ts'
import type { EngineVsm } from './engineVsm.ts'
import { casterDrawDistance, farDropOf, shadowSetting } from './vsmFarShadow.ts'

/** The buffers and groups of the caster rows (`WebgpuPagesRuntime.lights`, `vis.pageTable`), every
 *  one present. */
export interface VsmRasterRows {
  pageTable: GPUBuffer
  spheres: NonNullable<WebgpuPagesRuntime['lights']['spheres']>
  mobility: GPUBuffer
  rowLods: NonNullable<WebgpuPagesRuntime['lights']['rowLods']>
  pageLayout: GPUBindGroupLayout
  pageGroup: GPUBindGroup
}

/** The raster's scene of this frame over `rows`: the rows the table packs, the camera, the cut's
 *  world switch with its filter and draw distances, and the settings the raster reads. */
export function vsmRasterScene(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  plan: NonNullable<EngineVsm['plan']>,
  rows: VsmRasterRows,
  tessellation: VsmRenderScene['tessellation'],
): VsmRenderScene {
  const { gpu, layout, run } = rt
  const [width, height] = gpu.targetSize
  const cut = run.gpuSelection,
    cells = cut?.cellStates
  return {
    rowCount: layout.rows.packedCount,
    pageTable: rows.pageTable,
    spheres: rows.spheres.buffer,
    mobility: rows.mobility,
    rowLods: rows.rowLods.buffer,
    pageLayout: rows.pageLayout,
    pageGroup: rows.pageGroup,
    rowSpheres: rows.spheres,
    // The voxel tier is drawn while the table holds a voxel row (`vsmEncodeChunks`).
    voxels: layout.itemWordsHold.voxelRows > 0,
    tessellation,
    // The suns' far-shadow test: the world's merged shells, or every caster, and the distance past
    // which no view of the frame takes a caster (`vsmFarShadowSkipped`).
    farMeshes: shadowSetting(rt, 'farShadowCullsAllMeshes'),
    radiusThreshold: shadowSetting(rt, 'shadowRadiusThresholdUncached')
      ? shadowSetting(rt, 'shadowRadiusThreshold')
      : 0,
    farDrop: farDropOf(plan.lights),
    // The lights whose views pass a pass's limit are drawn in several passes (`vsmViewPasses`).
    multipassViews: shadowSetting(rt, 'shadowMultipassViews'),
    camera: {
      eye: cam.eye,
      view: cam.view,
      focalPixels: focalPixels(cam.projection, width, height),
      near: cam.near,
      perspective: cam.perspective === 1,
      threshold: run.gate.pixelError,
    },
    // The cut's world switch: a row the view does not draw casts nothing (`worldDraws`); its frame
    // words, where the objects' draw distances lie, a cut without a world has as well.
    world: cut && {
      cold: cells?.view,
      frames: cut.frames,
      links: cells?.links,
      // The main view's filter: a hidden object casts nothing into its shadows.
      filter: cut.holdFilter(run.selectionUniforms.filter),
    },
    // The draw distances the objects name: an object out of its own casts nothing.
    drawDistance: casterDrawDistance(rt, cut),
  }
}
