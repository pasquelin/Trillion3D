import { vsmViewToShifted } from '../froxel/froxelView.ts'
import { vsmLightGridFor, vsmProjectionReserve } from '../projection/projectionStore.ts'
import { LIGHT_SETTINGS } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
// The frame's shadow-map work on the GPU, from the change boxes to the mask the lighting reads.
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import {
  vsmCachePerPageBins,
  vsmPerPageFrame,
  vsmForwardZViewToClip,
  type VsmMarkingFrame,
  type VsmMarkingFront,
  type VsmMarkingView,
  type VsmPerPageFrame,
} from '../markingPass.ts'
import { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { writeChanged } from '../../../../gpu/core/writeChanged.ts'
import { taaRenderProjection } from '../../../../post/taa/frame.ts'
import {
  encodeVsmPageMapping,
  encodeVsmAfterRaster,
  encodeVsmPageCarry,
  resetVsmClearArgs,
} from '../pageManagementEncode.ts'
import type { VsmPageManagementFrame } from '../pageManagementPass.ts'
import type {
  VsmProjectionFrame,
  VsmProjectionLight,
  VsmProjectionSource,
  VsmProjectionTarget,
} from '../projection/projectionPass.ts'
import type { VsmLightAllocation } from '../frameSetup.ts'
import { encodeCastInvalidation, endCastInvalidation } from '../invalidation/castInvalidation.ts'
import { createCastChanges } from '../../casters/castChanges.ts'
import { encodeCastDiff } from '../../casters/castDiff.ts'
import { lightIdsBuffer, type EngineVsm } from './engineVsm.ts'
import { VSM_PASS_PREFIX } from '../../../../diagnostic/stage/passLabels.ts'
import { encodeVsmRaster, type VsmFrame } from './vsmProject.ts'
import {
  encodeVsmPyramid,
  prepareVsmPyramid,
  keepOcclusionTables,
  vsmOcclusionContext,
} from '../occlusion/occlusionPass.ts'
import { waterDepthMarked } from '../../../../blend/water/waterTargets.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import {
  markingFrontLayer,
  newFrontSeen,
  newMarkingFront,
  type VsmFrontSeen,
} from './vsmFrontLayer.ts'

/** The page marking's one compute pass (`markingPass.ts`). */
const MARKING_PASS: GPUComputePassDescriptor = { label: `${VSM_PASS_PREFIX}marking` }
/** The compute passes from the shadow changes to the page allocations, one pass but on a frame
 *  timed per pass. */
const frontRun = new ComputeRun()
const tailRun = new ComputeRun()
const forwardZViewToClip = new Float32Array(16)
/** This image's render projection, the TAA jitter in it (`taaRenderProjection`). */
const renderProjection = new Float64Array(16)

/** What a set's frames rebuild in place (`frameScratch`, kept on `EngineVsm.frameScratch`): the
 *  per-page entries and their bins, the suns' ids and the projection's context and sources. */
export interface VsmFrameScratch {
  perPage: VsmPerPageFrame
  suns: Uint32Array<ArrayBuffer>
  /** The image's projection, held until the depth pyramid holds its transparents (`encodeHeldVsmProjection`). */
  held?: { frame: VsmFrame; views: GPUTextureView[] }
  /** The frame's projection context (`projectionContext`, `vsmProject.ts`), which the opaque
   *  projection reads; this frame's while `projecting`. */
  context: VsmProjectionFrame & { lights: VsmProjectionLight[] }
  projecting: boolean
  /** The opaque source and where its projection stores, their fields set each frame. */
  opaque: VsmProjectionSource
  target: VsmProjectionTarget
  /** The marking's frame and its view of the engine's frame, their fields set each frame. */
  marking: VsmMarkingFrame
  markingView: VsmMarkingView
  /** The translucent front layer the marking reads (`markingFrontLayer`) and the image it last ran for. */
  markingFront: VsmMarkingFront
  frontSeen: VsmFrontSeen
  /** The plan's lights the raster draws, the fully cached ones left out (`rasterLights`). */
  raster: VsmLightAllocation[]
}
const frameScratch = (vsm: EngineVsm) =>
  (vsm.frameScratch ??= {
    perPage: vsmPerPageFrame(),
    suns: new Uint32Array(vsm.directionalIds.size / 4),
    context: {
      device: undefined as never,
      hizDepth: undefined as never,
      width: 0,
      height: 0,
      camera: { view: undefined as never, projection: undefined as never, perspective: true },
      frameIndex: 0,
      lights: [],
    },
    projecting: false,
    opaque: {
      depth: undefined as never,
      normalRough: undefined as never,
      flags: undefined as never,
      subsurface: undefined as never,
      lobes: undefined as never,
    },
    target: { suns: undefined as never, locals: undefined as never, localFormat: 'r32uint' },
    marking: {
      mapCount: 0,
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
      lightGrid: undefined as never,
      gridCells: 0,
      lightVsmIds: undefined as never,
      sunMapIds: undefined as never,
      sunMapCount: 0,
      viewRectMin: [0, 0],
      viewSize: [0, 0],
      viewToClip: forwardZViewToClip,
      viewToShifted: new Float32Array(16),
      originShift: [0, 0, 0],
      front: undefined,
      water: undefined,
    },
    markingFront: newMarkingFront(),
    frontSeen: newFrontSeen(),
    raster: [],
  })

/** The frame's statistics set from its plan, then the invalidation on the previous frame's maps,
 *  before the page addresses: the shadow changes the diff of the instances' boxes appends first, in
 *  this command buffer, then the CPU's boxes, one stale — the list, which it binds, made when no
 *  light cast yet. */
function encodeVsmChanges(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  steps: ComputeRun,
  vsm: EngineVsm,
  plan: NonNullable<EngineVsm['plan']>,
) {
  const { lights } = rt,
    { res, stats } = vsm
  stats.lights = plan.lights.length
  stats.maps = plan.projectionCount
  stats.tableBlocks = plan.tableBlocks
  stats.pressureBiasStat = vsm.state.cache.pressureBias
  stats.render = undefined
  stats.projectionPasses = 0
  if (vsm.pendingDiff) encodeCastDiff(rt, device, steps, vsm.pendingDiff)
  vsm.pendingDiff = null
  const boxes = vsm.pendingBoxes,
    casts = boxes ? (lights.casts ??= createCastChanges(device)) : lights.casts
  stats.invalidationThreads = casts
    ? encodeCastInvalidation(
        steps,
        res,
        device,
        vsm.prevSlots,
        vsm.pendingCastMaps,
        boxes,
        casts,
        vsm.state.maps.shadows.shadowCacheInvalidateUseHzb,
      )
    : 0
  vsm.pendingBoxes = null
  vsm.pendingCastMaps = null
}

/**
 * The frame's GPU work of the virtual shadow maps, after the light lists and before the lighting:
 * invalidation, page management, marking, allocation, raster and post-render; the projection, whose
 * screen rays march the depth pyramid, is held for after it (`encodeHeldVsmProjection`).
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
  const drawing = plan.projectionCount !== 0
  // Per-page dispatcher ids: every map with projection data this frame .
  const scratch = frameScratch(vsm)
  const perPage = vsmCachePerPageBins(state.cache, scratch.perPage)
  const pmFrame: VsmPageManagementFrame = {
    device,
    mapCount: plan.projectionCount,
    perPageBins: perPage.all,
    nextMapCount: plan.nextMapCount,
    options: {
      stats: vsm.countersOn,
      lruAllocation: state.maps.shadows.shadowCacheAllocateViaLru,
      fullClears: state.maps.shadows.shadowForceFullPageClears,
      skipDynamicInvalidation: state.maps.shadows.shadowCacheDebugSkipDynamicPageInvalidation,
    },
  }
  // What the passes of the run read cleared or copied before it, none between them: the overflow
  // flags, cleared whatever the counters say (they are read back every frame), the raster's marks,
  // which start at 0, and the clears' arguments.
  if (drawing) {
    encoder.clearBuffer(res.stats)
    encoder.clearBuffer(res.rasterMarks)
    resetVsmClearArgs(encoder, res, pmFrame)
  }
  const frame: VsmFrame | undefined = drawing
    ? {
        rt,
        device,
        encoder,
        cam,
        projection: taaRenderProjection(rt, cam, renderProjection),
        vsm,
        plan,
      }
    : undefined
  const steps = frontRun.begin(encoder)
  encodeVsmChanges(rt, device, steps, vsm, plan)
  const views = frame && encodeVsmMarking(steps, frame, scratch, perPage, pmFrame)
  steps.end()
  // The list the stale read, emptied once the run's passes are done.
  if (lights.casts) endCastInvalidation(encoder, lights.casts)
  if (!frame || !views) {
    vsm.renderedPlan = plan
    return
  }
  const drawn = rasterLights(plan, scratch.raster)
  // Every light fully cached: no page to draw, no tables to keep, no pyramid to build. The next frame,
  // with no previous tables kept, culls once a view pass.
  let pyramid: ReturnType<typeof vsmOcclusionContext>
  if (drawn.length === 0) vsm.renderedPlan = plan
  else {
    // The frame's tables kept for the occlusion's second cull and the next frame's first.
    keepOcclusionTables(encoder, res, { mapCount: plan.projectionCount, blocks: plan.tableBlocks })
    encodeVsmRaster(frame, drawn)
    // The pyramid's last build of the frame, over what the view passes drew since their own build
    // between the two culls.
    pyramid = vsmOcclusionContext(res, device)
    if (pyramid)
      prepareVsmPyramid(encoder, res, pyramid, readShadowSetting(rt, 'shadowOcclusionFullUpdate'))
  }
  // The build and the post-render follow one another: one compute pass, but on a frame timed per pass.
  resetVsmClearArgs(encoder, res, pmFrame)
  const tail = tailRun.begin(encoder)
  if (pyramid) encodeVsmPyramid(tail, res, pyramid)
  encodeVsmAfterRaster(tail, res, pmFrame)
  tail.end()
  scratch.held = { frame, views }
}

/** The lights of `plan` the raster draws, in `out`: those not fully cached (`VsmLightCache.isFullyCached`), a
 *  distant light drawn once, whose pages stay. */
function rasterLights(plan: NonNullable<EngineVsm['plan']>, out: VsmLightAllocation[]) {
  out.length = 0
  for (const light of plan.lights) if (!light.entry.isFullyCached()) out.push(light)
  return out
}

/** The page marking, a compute pass of the run `steps`: the physical page addresses remapped to this frame's ids,
 *  then the marking's clears, coarse pages and every pixel of the visibility buffer. The suns' ids
 *  and the light ids go up only where they changed. */
function encodeVsmMarking(
  steps: ComputeRun,
  { rt, device, cam, projection, vsm, plan }: VsmFrame,
  scratch: VsmFrameScratch,
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
  writeChanged(device, vsm.directionalIds, suns, 0, Math.max(directional, 1))
  if (vsm.lightIds.size < vsm.lightIdsData.byteLength) {
    vsm.lightIds.destroy()
    vsm.lightIds = lightIdsBuffer(device, vsm.lightIdsData.byteLength)
  }
  writeChanged(device, vsm.lightIds, vsm.lightIdsData, 0, vsm.lightIdsData.length)
  const views = gpu.surfaces!.views()
  const tiles = lights.tiles?.buffer
  const markingFrame = scratch.marking
  const front = markingFrontLayer(rt, cam, scratch.frontSeen, scratch.markingFront)
  markingFrame.mapCount = plan.projectionCount
  markingFrame.perPage = perPage
  markingFrame.perspective = cam.perspective === 1
  markingFrame.settings = vsm.state.maps.shadows
  if (lights.buffer && tiles) {
    const view = scratch.markingView
    view.depth = gpu.depthView!
    view.normalRough = views[1]
    view.flags = views[3]
    view.view = gpu.deferred!.uniform
    view.directLights = lights.buffer
    view.tileLights = tiles
    // Made before the pass, the grid the projection and the lighting read after it.
    const gridWords = lights.tiles!.worldStart
    view.lightGrid = vsmLightGridFor(
      device,
      vsmProjectionReserve(device, res),
      Math.max(gridWords, 1),
    )
    view.gridCells =
      gridWords && lights.tiles!.tilesX * lights.tiles!.tilesY * LIGHT_SETTINGS.gridSlices
    view.lightVsmIds = vsm.lightIds
    view.sunMapIds = vsm.directionalIds
    view.sunMapCount = directional
    view.viewSize[0] = width
    view.viewSize[1] = height
    view.viewToClip = vsmForwardZViewToClip(projection, forwardZViewToClip)
    view.originShift[0] = -cam.eye[0]
    view.originShift[1] = -cam.eye[1]
    view.originShift[2] = -cam.eye[2]
    vsmViewToShifted(view.viewToShifted as Float32Array, cam.view, view.originShift)
    view.front = front
    view.water = waterDepthMarked(rt)
    markingFrame.view = view
  } else markingFrame.view = undefined
  const marking = steps.pass(MARKING_PASS)
  encodeVsmPageCarry(marking, res, pmFrame)
  vsm.marking.encode(marking, markingFrame)
  encodeVsmPageMapping(steps, res, pmFrame)
  return views
}
