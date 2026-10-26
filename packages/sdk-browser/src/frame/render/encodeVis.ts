import type { EngineCamera } from '../../camera/engineCamera.ts'
import { encodeMaterialPasses } from '../../materials/classes/materialPasses.ts'
import { beginTransparentOcclusion } from '../../blend/transparent/occlusionHost.ts'
import { encodeWebgpuVisibilityPasses } from '../../visibility/passes/passes.ts'
import { skyLightSubmitted } from './encodeSkyLight.ts'
import { createRenderEncoder, submitColorCopy } from './encoder.ts'
import { encodeSurfaceLighting } from './surfaceLighting.ts'
import { followLobes } from '../prepare/lobesTarget.ts'
import {
  encodeEmptySurfaces,
  ensureGpuRaster,
  ensureVisBindings,
  visibilityRasterStages,
} from './encodeVisSetup.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** The visibility-buffer image: the decode and the bins of the clusters the cut listed, main and
 *  post raster passes, material surfaces, lighting and presentation, all in the image's command
 *  buffer. */
export function encodeVis(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, layout } = rt
  if (
    !vis.visBindGroupLayout ||
    !gpu.cache ||
    !vis.concatPos ||
    !gpu.depthView ||
    !vis.visView ||
    !vis.visPipelineBack ||
    !vis.shadeClasses ||
    !vis.pageTable
  )
    return
  const depthTarget = gpu.depthView
  const [width, height] = gpu.targetSize
  followLobes(rt) // Every image's, one of transmissive lobed surfaces alone too.
  // A scene with no opaque page draws the surfaces' clear alone.
  if (!run.gpuSelection || layout.packedPages.length === layout.blendedPageCount)
    return encodeEmptySurfaces(rt, device, cam, depthTarget)
  ensureGpuRaster(rt, device)
  // The identifiers name the clusters of the cut's list: the decoded table holds a record for each.
  const tableRows = vis.gpuBins!.cap
  ensureVisBindings(rt, device, cam, tableRows)
  const encoder = createRenderEncoder(rt, device)
  // The frame the transparent clusters are tested under, written before the image's commands.
  beginTransparentOcclusion(rt, cam)
  // This image's pyramid is the one the next image's cut occlusion reads (`noOccluderHistory`).
  run.noOccluderHistory = false
  run.gpuComputeDispatches = 0
  // The main pass's decode and binning run first: the clusters the cut listed before its post pass.
  // The post pass's are decoded and binned by the raster's `rest` (`encodeVisSetup.ts`).
  const raster = visibilityRasterStages(rt, device, encoder)
  if (!raster) throw new Error('VISIBILITY_RASTER_UNAVAILABLE')
  encodeWebgpuVisibilityPasses(rt, encoder, raster)
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView) throw new Error('DEFERRED_UNAVAILABLE')
  // Surfaces, one class at a time, and the virtual-texture feedback target where each opaque
  // pixel posts the tile rank it wants — completed by transparents, reduced to counts at submit.
  encodeMaterialPasses(rt, encoder)
  // The voxel trace's counters of a sampled image, copied, then mapped once the image is
  // submitted: no image waits for that readback.
  vis.voxelSteps?.encodeCopy(encoder, run.frame)
  const presented = encodeSurfaceLighting(rt, device, encoder, cam)
  submitColorCopy(rt, device, encoder, height, width, presented)
  // A captured scene that is due is drawn between this image and the next.
  skyLightSubmitted(rt)
}
