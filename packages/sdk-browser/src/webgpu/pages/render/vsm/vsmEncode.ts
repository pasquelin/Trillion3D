// The frame's shadow-map work on the GPU, from the change boxes to the mask the lighting reads.
import type { EngineCamera } from '../../../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import {
  vsmCachePerPageBins,
  vsmPerPageFrame,
  vsmForwardZViewToClip,
  type VsmMarkingFrame,
  type VsmPerPageFrame,
} from '../../../../vsm/markingPass.ts'
import { vsmWriteChanged } from '../../../../vsm/writeChanged.ts'
import {
  encodeVsmPageMapping,
  encodeVsmAfterRaster,
  encodeVsmPageCarry,
  type VsmPageManagementFrame,
} from '../../../../vsm/pageManagementPass.ts'
import {
  encodeVirtualShadowProjection,
  type VsmProjectionLight,
} from '../../../../vsm/projectionPass.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../../../../vsm/projectionWgsl.ts'
import { encodeVsmInvalidations } from '../../../../vsm/invalidationPass.ts'
import { shadowPageGroup } from '../../../shadow/pageGroup.ts'
import { taaRenderMatrix } from '../../../../taa/frame.ts'
import { invertMatrix4 } from '../../../../../../sdk-core/src/math/matrix/matrix4Inverse.ts'
import { multiplyMatrix4 } from '../../../../../../sdk-core/src/math/matrix/matrix4.ts'
import { ensureMask, lightIdsBuffer, maskLayersFor, type EngineVsm } from './engineVsm.ts'
import { projectionLight } from './vsmPlan.ts'
import { encodeVsmRenderAndTransmission } from './vsmTransmission.ts'

/** The page marking's one compute pass (`markingPass.ts`). */
const MARKING_PASS: GPUComputePassDescriptor = { label: 'vsm.marking' }
const viewInverse = new Float64Array(16),
  renderMatrix = new Float64Array(16),
  jitteredProjection = new Float64Array(16),
  forwardZViewToClip = new Float32Array(16)

/** What a set's frames rebuild in place (`frameScratch`): the per-page entries and their bins, the
 *  suns' ids and the lights the projection reads. */
interface FrameScratch {
  perPage: VsmPerPageFrame
  suns: Uint32Array<ArrayBuffer>
  projected: VsmProjectionLight[]
}
const SCRATCH = new WeakMap<EngineVsm, FrameScratch>()
const frameScratch = (vsm: EngineVsm) => {
  let scratch = SCRATCH.get(vsm)
  if (!scratch)
    SCRATCH.set(
      vsm,
      (scratch = {
        perPage: vsmPerPageFrame(),
        suns: new Uint32Array(vsm.directionalIds.size / 4),
        projected: [],
      }),
    )
  return scratch
}
/** The projection the raster drew this image with, the TAA jitter in it (\`taaRenderMatrix\`):
 *  the depth the projection reconstructs each pixel from was drawn jittered, so the projection
 *  reconstructs it with the jittered view (#1363). */
function rasterProjection(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  invertMatrix4(viewInverse, cam.view)
  renderMatrix.set(taaRenderMatrix(rt, cam))
  multiplyMatrix4(jitteredProjection, renderMatrix, viewInverse)
  return jitteredProjection
}

/**
 * The frame's GPU work of the virtual shadow maps, after the light lists and before the lighting:
 * invalidation, page management, marking, allocation, raster, post-render and projection.
 */
export function encodeVsmFrame(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { lights, gpu, vis, layout, run } = rt,
    vsm = lights.vsm,
    plan = vsm?.plan
  if (!vsm || !plan || !gpu.surfaces || !gpu.depthView || !gpu.deferred) return
  const { res, state } = vsm
  const [width, height] = gpu.targetSize
  const stats = vsm.stats
  stats.lights = plan.lights.length
  stats.fullMaps = plan.fullMapCount
  stats.singlePageMaps = plan.singlePageMapCount
  stats.pressureBiasStat = state.cache.pressureBias
  stats.render = undefined
  stats.projectionPasses = 0
  // The instance page invalidation on the previous frame's maps, before the page addresses.
  stats.invalidationThreads = encodeVsmInvalidations(
    encoder,
    res,
    { device, mapSlotCount: vsm.prevSlots },
    [vsm.pendingBoxes],
  )
  vsm.pendingBoxes = null
  if (plan.projectionCount === 0) {
    vsm.renderedPlan = plan
    return
  }

  // Per-page dispatcher ids: every map with projection data this frame .
  const scratch = frameScratch(vsm)
  const perPage = vsmCachePerPageBins(state.cache, scratch.perPage)
  const pmFrame: VsmPageManagementFrame = {
    device,
    mapCount: plan.projectionCount,
    fullMapCount: plan.fullMapCount,
    perPageBins: perPage.all,
    nextMapCount: plan.nextMapCount,
    options: { stats: vsm.countersOn },
  }
  if (vsm.countersOn) encoder.clearBuffer(res.stats)

  // The page marking, one compute pass: the physical page addresses remapped to this frame's ids,
  // then the marking's clears, coarse pages and every pixel of the visibility buffer. The suns' ids
  // and the light ids go up only where they changed.
  const suns = scratch.suns
  let directional = 0
  for (const light of plan.lights)
    if (light.kind === 'directional') suns[directional++] = light.firstId
  if (directional === 0) suns[0] = 0
  vsmWriteChanged(device, vsm.directionalIds, suns, 0, Math.max(directional, 1))
  if (vsm.lightIds.size < vsm.lightIdsData.byteLength) {
    vsm.lightIds.destroy()
    vsm.lightIds = lightIdsBuffer(device, vsm.lightIdsData.byteLength)
  }
  vsmWriteChanged(device, vsm.lightIds, vsm.lightIdsData, 0, vsm.lightIdsData.length)
  const views = gpu.surfaces.views()
  const tiles = lights.tiles?.buffer
  const markingFrame: VsmMarkingFrame = {
    fullMapCount: plan.fullMapCount,
    singlePageMapCount: plan.singlePageMapCount,
    perPage,
    view:
      lights.buffer && tiles
        ? {
            depth: gpu.depthView,
            normalRough: views[1],
            flags: views[3],
            view: gpu.deferred.uniform,
            directLights: lights.buffer,
            tileLights: tiles,
            lightVsmIds: vsm.lightIds,
            sunMapIds: vsm.directionalIds,
            sunMapCount: directional,
            viewRectMin: [0, 0],
            viewSize: [width, height],
            viewToClip: vsmForwardZViewToClip(cam.projection, forwardZViewToClip),
            originShift: [-cam.eye[0], -cam.eye[1], -cam.eye[2]],
          }
        : undefined,
  }
  // The raster's raster marks start at 0, before the pass.
  encoder.clearBuffer(res.rasterMarks)
  const marking = encoder.beginComputePass(MARKING_PASS)
  encodeVsmPageCarry(marking, res, pmFrame)
  vsm.marking.encode(marking, markingFrame)
  marking.end()
  encodeVsmPageMapping(encoder, res, pmFrame)

  // The non-cluster raster: the resident cluster rows at the main view's detail.
  const pageGroup = shadowPageGroup(rt, device)
  const { spheres, mobilityRows, rowLods, pageLayout } = lights
  if (pageGroup && spheres && mobilityRows && rowLods && pageLayout && vis.pageTable) {
    const p = cam.projection
    vsm.renderedPlan = plan
    stats.render = encodeVsmRenderAndTransmission(
      rt,
      vsm,
      encoder,
      res,
      { device, lights: plan.lights },
      {
        rowCount: layout.rows.packedCount,
        pageTable: vis.pageTable,
        spheres: spheres.buffer,
        mobility: mobilityRows,
        rowLods: rowLods.buffer,
        pageLayout,
        pageGroup,
        rowSpheres: spheres,
        camera: {
          eye: cam.eye,
          view: cam.view,
          focalPixels: Math.max((p[0] * width) / 2, (p[5] * height) / 2),
          near: cam.near,
          perspective: cam.perspective === 1,
          threshold: run.gate.pixelError,
        },
      },
    )
  }
  encodeVsmAfterRaster(encoder, res, pmFrame)

  // Projection: one pass, every light a channel reads (`planVsmFrame`: the first 64), four a layer
  // of the mask array. None when the plan holds no light — every lamp culled, its cache entries
  // still counted —: every light then reads no shadow (`planVsmFrame` assigns −1), so no pixel
  // reads the mask, and a pass of no light would store no texel of it.
  const store = lights.store
  const projected = scratch.projected,
    reads = Math.min(plan.lights.length, VSM_PROJECTION_MAX_PASS_LIGHTS)
  projected.length = reads
  for (let k = 0; k < reads; k++) {
    const l = plan.lights[k]
    projected[k] = projectionLight(store.light(l.id)!, l.firstId)
  }
  if (!projected.length) return
  const layers = maskLayersFor(projected.length)
  // At the targets' size, as the scene textures are at theirs: the view rect is its
  // top-left, and a dynamic-resolution step does not remake it.
  const mask = ensureMask(device, vsm, gpu.allocatedSize[0], gpu.allocatedSize[1], layers)
  // The engine's shadow receiver, as the resolve wrote it (`receiverTargetWgsl.ts`).
  const receiver = gpu.surfaces.receiverView
  const camera = {
    view: cam.view,
    projection: rasterProjection(rt, cam),
    perspective: cam.perspective === 1,
  }
  encodeVirtualShadowProjection(
    encoder,
    res,
    {
      device,
      depth: gpu.depthView,
      normalRough: views[1],
      flags: views[3],
      width,
      height,
      bufferWidth: gpu.allocatedSize[0],
      bufferHeight: gpu.allocatedSize[1],
      camera,
      frameIndex: run.frame,
      mask: mask.view,
      maskTiles: mask.tilesView,
      receiver,
    },
    projected,
  )
  stats.projectionPasses = 1
}
