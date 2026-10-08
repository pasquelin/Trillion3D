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
import type { VsmProjectionLight } from '../../../../vsm/projectionPass.ts'
import { encodeVsmInvalidations } from '../../../../vsm/invalidationPass.ts'
import { lightIdsBuffer, type EngineVsm } from './engineVsm.ts'
import { encodeVsmProjection, encodeVsmRaster, type VsmFrame } from './vsmProject.ts'

/** The page marking's one compute pass (`markingPass.ts`). */
const MARKING_PASS: GPUComputePassDescriptor = { label: 'vsm.marking' }
const forwardZViewToClip = new Float32Array(16)

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
  const { lights, gpu } = rt,
    vsm = lights.vsm,
    plan = vsm?.plan
  if (!vsm || !plan || !gpu.surfaces || !gpu.depthView || !gpu.deferred) return
  const { res, state } = vsm
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
  const frame: VsmFrame = { rt, device, encoder, cam, vsm, plan }
  const views = encodeVsmMarking(frame, scratch, perPage, pmFrame)
  encodeVsmRaster(frame)
  encodeVsmAfterRaster(encoder, res, pmFrame)
  if (encodeVsmProjection(frame, scratch.projected, views)) stats.projectionPasses = 1
}

/** The page marking, one compute pass: the physical page addresses remapped to this frame's ids,
 *  then the marking's clears, coarse pages and every pixel of the visibility buffer. The suns' ids
 *  and the light ids go up only where they changed. */
function encodeVsmMarking(
  { rt, device, encoder, cam, vsm, plan }: VsmFrame,
  scratch: FrameScratch,
  perPage: ReturnType<typeof vsmCachePerPageBins>,
  pmFrame: VsmPageManagementFrame,
) {
  const { lights, gpu } = rt,
    { res } = vsm
  const [width, height] = gpu.targetSize
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
  const views = gpu.surfaces!.views()
  const tiles = lights.tiles?.buffer
  const markingFrame: VsmMarkingFrame = {
    fullMapCount: plan.fullMapCount,
    singlePageMapCount: plan.singlePageMapCount,
    perPage,
    view:
      lights.buffer && tiles
        ? {
            depth: gpu.depthView!,
            normalRough: views[1],
            flags: views[3],
            view: gpu.deferred!.uniform,
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
  return views
}
