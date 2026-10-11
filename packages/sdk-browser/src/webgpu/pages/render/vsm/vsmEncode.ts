// The frame's shadow-map work on the GPU, from the change boxes to the mask the lighting reads.
import type { EngineCamera } from '../../../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import {
  vsmCachePerPageBins,
  vsmPerPageFrame,
  vsmForwardZViewToClip,
  type VsmMarkingFrame,
  type VsmMarkingView,
  type VsmPerPageFrame,
} from '../../../../vsm/markingPass.ts'
import { taaRenderProjection } from '../../../../taa/frame.ts'
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
import { VSM_PASS_PREFIX } from '../../../../stage/passLabels.ts'
import { encodeVsmProjection, encodeVsmRaster, type VsmFrame } from './vsmProject.ts'

/** The page marking's one compute pass (`markingPass.ts`). */
const MARKING_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}marking` }
const forwardZViewToClip = new Float32Array(16)
/** This image's render projection, the TAA jitter in it (`taaRenderProjection`). */
const renderProjection = new Float64Array(16)

/** What a set's frames rebuild in place (`frameScratch`): the per-page entries and their bins, the
 *  suns' ids and the lights the projection reads. */
interface FrameScratch {
  perPage: VsmPerPageFrame
  suns: Uint32Array<ArrayBuffer>
  projected: VsmProjectionLight[]
  /** The marking's frame and its view of the engine's frame, their fields set each frame. */
  marking: VsmMarkingFrame
  markingView: VsmMarkingView
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
        marking: {
          fullMapCount: 0,
          singlePageMapCount: 0,
          perPage: undefined as never,
          perspective: true,
          view: undefined,
        },
        markingView: {
          depth: undefined as never,
          normalRough: undefined as never,
          flags: undefined as never,
          view: undefined as never,
          directLights: undefined as never,
          tileLights: undefined as never,
          lightVsmIds: undefined as never,
          sunMapIds: undefined as never,
          sunMapCount: 0,
          viewRectMin: [0, 0],
          viewSize: [0, 0],
          viewToClip: forwardZViewToClip,
          originShift: [0, 0, 0],
        },
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
  const frame: VsmFrame = {
    rt,
    device,
    encoder,
    cam,
    projection: taaRenderProjection(rt, cam, renderProjection),
    vsm,
    plan,
  }
  const views = encodeVsmMarking(frame, scratch, perPage, pmFrame)
  encodeVsmRaster(frame)
  encodeVsmAfterRaster(encoder, res, pmFrame)
  stats.projectionPasses = encodeVsmProjection(frame, scratch.projected, views)
}

/** The page marking, one compute pass: the physical page addresses remapped to this frame's ids,
 *  then the marking's clears, coarse pages and every pixel of the visibility buffer. The suns' ids
 *  and the light ids go up only where they changed. */
function encodeVsmMarking(
  { rt, device, encoder, cam, projection, vsm, plan }: VsmFrame,
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
  const markingFrame = scratch.marking
  markingFrame.fullMapCount = plan.fullMapCount
  markingFrame.singlePageMapCount = plan.singlePageMapCount
  markingFrame.perPage = perPage
  markingFrame.perspective = cam.perspective === 1
  if (lights.buffer && tiles) {
    const view = scratch.markingView
    view.depth = gpu.depthView!
    view.normalRough = views[1]
    view.flags = views[3]
    view.view = gpu.deferred!.uniform
    view.directLights = lights.buffer
    view.tileLights = tiles
    view.lightVsmIds = vsm.lightIds
    view.sunMapIds = vsm.directionalIds
    view.sunMapCount = directional
    view.viewSize[0] = width
    view.viewSize[1] = height
    view.viewToClip = vsmForwardZViewToClip(projection, forwardZViewToClip)
    view.originShift[0] = -cam.eye[0]
    view.originShift[1] = -cam.eye[1]
    view.originShift[2] = -cam.eye[2]
    markingFrame.view = view
  } else markingFrame.view = undefined
  // The raster's raster marks start at 0, before the pass.
  encoder.clearBuffer(res.rasterMarks)
  const marking = encoder.beginComputePass(MARKING_PASS)
  encodeVsmPageCarry(marking, res, pmFrame)
  vsm.marking.encode(marking, markingFrame)
  marking.end()
  encodeVsmPageMapping(encoder, res, pmFrame)
  return views
}
