import type { EngineCamera } from '../../camera/engineCamera.ts'
import { encodeMaterialPasses } from '../../materials/classes/materialPasses.ts'
import { beginTransparentOcclusion } from '../../blend/transparent/occlusionHost.ts'
import { encodeWebgpuVisibilityPasses } from '../../visibility/passes/passes.ts'
import { skyLightSubmitted } from './encodeSkyLight.ts'
import { abandonFrameEncoder, submitColorCopy, withRenderEncoder } from './encoder.ts'
import { objectShadowTableAwaited } from '../../blend/objectShadow/objectShadowSelf.ts'
import { encodeSurfaceLighting } from './surfaceLighting.ts'
import { encodeSkyMeshFace } from './encodeSkyMeshFace.ts'
import { followTargets } from '../prepare/followTargets.ts'
import {
  encodeEmptySurfaces,
  ensureGpuRaster,
  ensureVisBindings,
  visibilityRasterStages,
} from './encodeVisSetup.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { encodeHzbOcclusion } from '../../visibility/hzbOcclusion/hzbOcclusion.ts'

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
  // A face of the sky meshes' capture draws its sky surfaces alone, by the blend pass (`ViewOverrides.skyMeshCapture`).
  if (rt.views.active.overrides.skyMeshCapture) return encodeSkyMeshFace(rt, device, cam)
  // The view of the custom depth draws the visibility of the objects that ask for it alone (`ViewOverrides.customDepthCapture`).
  if (rt.views.active.overrides.customDepthCapture) return encodeCustomDepthView(rt, device, cam)
  followTargets(rt) // The lobes, the closure slices and the translucency targets follow what they name.
  // A scene with no opaque page draws the surfaces' clear alone.
  if (!run.gpuSelection || layout.packedPages.length === layout.blendedPageCount)
    return encodeEmptySurfaces(rt, device, cam, depthTarget)
  ensureGpuRaster(rt, device)
  // The identifiers name the clusters of the cut's list: the decoded table holds a record for each.
  const tableRows = vis.gpuBins!.cap
  ensureVisBindings(rt, device, cam, tableRows)
  withRenderEncoder(rt, device, (encoder) => {
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
    // The roots tested against the depth just built, their verdicts read a few images later (`hzbOcclusion`).
    encodeHzbOcclusion(rt, cam, encoder)
    // The voxel trace's counters of a sampled image, copied, then mapped once the image is
    // submitted: no image waits for that readback.
    vis.voxelSteps?.encodeCopy(encoder, run.frame)
    const presented = encodeSurfaceLighting(rt, device, encoder, cam)
    // The translucent object shadows' packed table the records need is asked at the publication, once the shadow maps know their rows: the image that found it too small drew its
    // layers with stand-ins, so it is dropped unsubmitted (the previous image stays shown) and the next frames are held on the device's answer (`deviceAnswer`).
    if (objectShadowTableAwaited(rt)) return abandonFrameEncoder(rt)
    submitColorCopy(rt, device, encoder, height, width, presented)
  })
  // A captured scene that is due is drawn between this image and the next.
  skyLightSubmitted(rt)
}

/**
 * The image of the custom depth view (`ViewOverrides.customDepthCapture`): the visibility of the objects its cut kept, rastered as the main view's
 * is, then emitted into the custom depth targets in the place of the surfaces' shading. A scene with no opaque page draws nothing: the targets are
 * cleared.
 */
function encodeCustomDepthView(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, layout } = rt
  const capture = rt.views.active.overrides.customDepthCapture!
  const [width, height] = gpu.targetSize
  const empty = !run.gpuSelection || layout.packedPages.length === layout.blendedPageCount
  // What the main view's image needs to be drawn (`encodeVis`).
  const drawable =
    !empty &&
    !!vis.visBindGroupLayout &&
    !!gpu.cache &&
    !!vis.concatPos &&
    !!gpu.depthView &&
    !!vis.visView &&
    !!vis.visPipelineBack &&
    !!vis.shadeClasses &&
    !!vis.pageTable
  if (drawable) {
    followTargets(rt)
    ensureGpuRaster(rt, device)
    ensureVisBindings(rt, device, cam, vis.gpuBins!.cap)
  }
  withRenderEncoder(rt, device, (encoder) => {
    if (drawable) {
      run.noOccluderHistory = false
      run.gpuComputeDispatches = 0
      const raster = visibilityRasterStages(rt, device, encoder)
      if (!raster) throw new Error('VISIBILITY_RASTER_UNAVAILABLE')
      encodeWebgpuVisibilityPasses(rt, encoder, raster)
    }
    capture.emit(encoder, drawable)
    submitColorCopy(rt, device, encoder, height, width)
  })
}
