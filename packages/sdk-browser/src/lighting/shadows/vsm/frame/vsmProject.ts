// The frame's shadow-map raster and projection (`vsmEncode.ts`).
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { clamp } from '../../../../../../math/src/scalar/reals.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import {
  encodeVirtualShadowProjection,
  writeVsmProjectionFrame,
} from '../projection/projectionPass.ts'
import {
  encodeVsmHairProjection,
  releaseVsmHairProjection,
  vsmHairMasks,
} from '../projection/hairProjectionPass.ts'
import { PER_LIGHT_MASK_LAYERS } from '../projection/maskFormat.ts'
import {
  encodeFirstPersonSelfShadow,
  firstPersonSelfShadowOn,
} from '../../firstPerson/selfShadow.ts'
import { sunCount, VSM_PROJECTION_MAX_PASS_LIGHTS } from '../projection/projectionView.ts'
import {
  capsuleCastsDirect,
  capsuleLightMask,
  capsuleLocalLayers,
  encodeCapsuleSunMasks,
} from '../../../capsuleShadows/host.ts'
import { encodeHairSurfaceShadow } from '../../../../hair/surfaceShadowPass.ts'
import { beginPerLightFrame } from '../projection/perLightPass.ts'
import { noteVsmRequestSet } from '../traversal/requests.ts'
import {
  shadowPageComputeGroup,
  shadowPageComputeLayout,
  shadowPageGroup,
} from '../../casters/pageGroup.ts'
import { lightingPhase } from '../../../surfaceCache/lighting/phase.ts'
import { shadowEpoch } from '../../../../frame/backend/state/shadowEpoch.ts'
import { shadowsUnsettled } from '../../../../frame/backend/state/lights.ts'
import { lightGridCulled } from '../../../tiles/cullView.ts'
import { ensureMask, type VsmPerLightMask } from './vsmMask.ts'
import { vsmProjectionReserve } from '../projection/projectionStore.ts'
import { shadowsOnePass } from './vsmGates.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { LIGHT_SETTINGS } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import type { VsmBoundLight } from '../mapViews.ts'
import type { EngineVsm } from './engineVsm.ts'
import type { VsmProjectionSource } from '../projection/projectionPass.ts'
import type { VsmFrameScratch } from './vsmEncode.ts'
import type { VsmThrottleState } from '../throttle.ts'
import { projectionLight } from './vsmPlan.ts'
import { sunCascadesOf } from './vsmDense.ts'
import type { ClassicSettings, ClassicSun } from '../../classic/classicView.ts'
import { nearInCentimetres } from '../../classic/denseEntries.ts'
import { vsmRasterScene } from './vsmRasterScene.ts'
import { vsmMapSettings } from './vsmFarShadow.ts'
import { vsmTraceKey } from './vsmProjectionHold.ts'
import { encodeVsmRender } from '../render/renderPass.ts'
import { vsmSortedExtraRecords } from '../render/renderLists.ts'
import { vsmViewsLaid } from '../render/renderParamsWgsl.ts'
import { outOfMemoryContext } from '../../../../session/memory/outOfMemory.ts'
import { vsmShadowTessellation } from '../tessellation/shadowChain.ts'
import { bindCasterInputs, casterDecode, ensureCasterFeed } from '../../casters/casterFeed.ts'
import { cutListCaps, limitedCaps } from '../../../../geometry/dag/lists/cutListCaps.ts'
import { storageBufferCap } from '../../../../session/memory/pools.ts'
import { VSM_RENDER_RECORD_BYTES, vsmRecordCapacity } from '../constants.ts'

/** What a frame's VSM steps read: the engine, the device, the encoder, the camera, the projection
 *  the raster drew this image with (the TAA jitter in it, `taaRenderProjection`: the depth the
 *  marking and the projection reconstruct each pixel from was drawn jittered, #1363), the shadow
 *  maps and their plan. */
export interface VsmFrame {
  rt: WebgpuPagesRuntime
  device: GPUDevice
  encoder: GPUCommandEncoder
  cam: EngineCamera
  projection: Float64Array
  vsm: EngineVsm
  plan: NonNullable<EngineVsm['plan']>
  /** The compute throttle's buffers where it runs this frame (`vsmThrottleState`), and the strength the
   *  render-scale controller gave it (`askVsmThrottleStrength`). */
  throttle?: VsmThrottleState
  strength: number
}

/** Says once per set that the GPU budget's room held the shadow raster's records short of the room
 *  asked, or held no list at all. */
function sayRoomLimited(rt: WebgpuPagesRuntime, vsm: EngineVsm, skipped: boolean) {
  if (vsm.said.has('raster')) return
  vsm.said.add('raster')
  rt.diag.engineDiagnostic(
    'gpu-out-of-memory',
    skipped
      ? 'The GPU budget holds no shadow raster lists this frame: its pages wait'
      : 'The GPU budget holds the shadow raster to fewer records: the pages past them wait',
    outOfMemoryContext('shadow', null),
  )
}

/** The records a view pass of the raster holds room for, fixed: the cut's cap of visible clusters
 *  (`cutMaxVisibleClusters`, held to the device: `limitedCaps`) times the raster's indirection
 *  multiplier (`vsmRecordCapacity`), within one binding of records, the sorted list's extra records
 *  for `maps` maps (`vsmSortedExtraRecords`) among them. */
const recordLimit = (rt: WebgpuPagesRuntime, device: GPUDevice, maps: number) =>
  clamp(
    Math.floor(storageBufferCap(device.limits) / VSM_RENDER_RECORD_BYTES) -
      vsmSortedExtraRecords(maps, vsmViewsLaid(device)),
    1,
    vsmRecordCapacity(
      limitedCaps(cutListCaps(rt.context), device.limits).visible,
      readShadowSetting(rt, 'shadowRasterIndirectionMultiplier'),
    ),
  )

/** The shadow raster of `lights`, the plan's but the fully cached ones: every resident cluster that may
 *  cast, listed and decoded as the casters of this frame, each map view selecting its own level of
 *  detail of them. */
export function encodeVsmRaster(
  { rt, device, encoder, cam, vsm, plan, throttle }: VsmFrame,
  lights: readonly VsmBoundLight[],
) {
  const { lights: sceneLights, layout, rootWorlds } = rt
  const cut = rt.run.gpuSelection,
    tables = cut?.cutTables()
  const { pageLayout, rootWords } = sceneLights
  const rootBoxes = rootWorlds?.boxes
  if (!cut || !tables || !pageLayout || !rootWords || !rootBoxes) return
  const rows = layout.placement.packedCount,
    candidates = layout.clusters.candidateCount
  // Nothing resident that may cast: the pages are drawn empty.
  if (rows <= 0 || candidates <= 0) {
    vsm.renderedPlan = plan
    return
  }
  // The clusters that may cast, within the cut's cap of candidate clusters.
  const room = Math.min(candidates, cutListCaps(rt.context).candidates)
  const feed = ensureCasterFeed(rt, device, room)
  const pageGroup = shadowPageGroup(rt, device)
  // The decode of the casters compiling, or a table missing: the pages wait, none is kept as cached.
  if (!pageGroup || !casterDecode(device).ready || !bindCasterInputs(rt, feed)) return
  vsm.renderedPlan = plan
  const tessellation = vsmShadowTessellation(rt, device, vsm, pageLayout)
  const records = recordLimit(rt, device, vsm.res.layout.mapSlots)
  const casters = { cut, tables, feed, rootWords, rootBoxes, rows, candidates, room, records }
  // The software half's page rows: the same entries, seen by the compute stage.
  const computeGroup = shadowPageComputeGroup(rt, device)
  const pageCompute = computeGroup && {
    layout: shadowPageComputeLayout(device),
    group: computeGroup,
  }
  const scene = vsmRasterScene(
    rt,
    cam,
    plan,
    { ...casters, pageLayout, pageGroup, pageCompute },
    tessellation,
  )
  const frame = { device, lights, throttle }
  // The streaming reads the shadow views' requests of this set (`vsmShadowRequestCuts`).
  noteVsmRequestSet(rt, vsm.res)
  const stats = encodeVsmRender(encoder, vsm.res, frame, scene)
  vsm.stats.render = stats
  if (stats?.roomLimited) sayRoomLimited(rt, vsm, stats.passes === 0 && !stats.empty)
  // No list within the budget's room: no page drawn, none kept as cached.
  if (stats?.passes === 0 && !stats.empty) vsm.renderedPlan = undefined
}

const classicSuns: ClassicSun[] = []
const classicScratch = {
  suns: classicSuns,
  nearCentimetres: 0,
  settings: undefined as unknown as ClassicSettings,
}

/** The classic shadows' words of the frame's view (`shadowVirtualEnable` off): its suns, with the cascades their lights name, and the settings. */
function classicOf(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  plan: NonNullable<EngineVsm['plan']>,
  shadows: ClassicSettings,
) {
  classicSuns.length = 0
  for (const lane of plan.projected) {
    if (!lane.clipmap || lane.firstPerson) continue
    const light = rt.lights.store.light(lane.id)
    classicSuns.push({
      mapId: lane.firstId,
      firstLevel: lane.clipmap.firstLevel,
      cascades: light && sunCascadesOf(light),
    })
  }
  classicScratch.nearCentimetres = nearInCentimetres(cam.near)
  classicScratch.settings = shadows
  return classicScratch
}

/** The frame's projection context (`VsmProjectionFrame`), rebuilt in place in `scratch` from the
 * plan's lights a channel reads (`planVsmFrame`), the camera, the phase and the depth
 * pyramid, and written once into the view uniform (`writeVsmProjectionFrame`): what the opaque
 * projection and the translucent layers' traces read, whether the projection runs or is held. None when the plan
 * holds no light — every lamp culled, its cache entries still counted —: every light then reads no
 * shadow (`planVsmFrame` assigns −1), so no pixel reads a mask —, nor without the pyramid. */
function projectionContext(
  { rt, device, cam, projection, vsm, plan }: VsmFrame,
  scratch: VsmFrameScratch,
) {
  const { lights, gpu } = rt
  const store = lights.store
  const context = scratch.context
  const projected = context.lights
  const reads = Math.min(plan.projected.length, VSM_PROJECTION_MAX_PASS_LIGHTS)
  projected.length = reads
  for (let k = 0; k < reads; k++) {
    const l = plan.projected[k]
    projected[k] = projectionLight(store.light(l.id)!, l.firstId, plan.firstPersonOf.get(l.id))
  }
  // The depth the screen ray marches, its pyramid complete (`encodeDepthPyramid`).
  const hizDepth = rt.vis.gpuHiz?.depth()
  if (!projected.length || !hizDepth) return undefined
  context.device = device
  context.hizDepth = hizDepth
  context.width = gpu.targetSize[0]
  context.height = gpu.targetSize[1]
  context.camera.view = cam.view
  context.camera.projection = projection
  context.camera.perspective = cam.perspective === 1
  context.frameIndex = lightingPhase(rt)
  const { shadows } = vsmMapSettings(rt)
  context.trace = shadows
  context.classic = shadows.shadowVirtualEnable ? undefined : classicOf(rt, cam, plan, shadows)
  writeVsmProjectionFrame(vsm.res, context)
  scratch.projecting = true
  return context
}

/** The names of the context's lights, in its order (`encodeHairSurfaceShadow`). */
const hairLightIds: string[] = []

/** The ranks, in the light buffer, of the context's lights, indexed as they are (`takePerLightPath`). */
const perLightRanks: number[] = []

/** The per-light path of the frame (`shadowOnePassProjection` false): the shadowed local lights of the
 *  context, past its suns, each to be lit alone by the lighting (`perLightPass.ts`), into `mask`. */
function takePerLightPath(
  { rt, device, vsm, plan, cam }: VsmFrame,
  context: NonNullable<ReturnType<typeof projectionContext>>,
  source: VsmProjectionSource,
  mask: VsmPerLightMask,
  hairShadow: GPUTextureView | undefined,
) {
  perLightRanks.length = context.lights.length
  for (let k = sunCount(context.lights); k < context.lights.length; k++)
    perLightRanks[k] = rt.lights.store.slotOf(plan.projected[k].id)
  return beginPerLightFrame({
    device,
    res: vsm.res,
    frame: context,
    source,
    mask,
    ranks: perLightRanks,
    // The classic projection clears each light's mask layer before it draws it, as the reference's classic branch does and its virtual one does not.
    forceClear:
      readShadowSetting(rt, 'shadowForcePerLightMaskClear') ||
      !readShadowSetting(rt, 'shadowVirtualEnable'),
    afterMask: capsuleLightMask(rt, cam),
    hairShadow,
  })
}

/** The opaque projection's inputs: the image's depth, normals and flags, the surfaces' words and the lights the lighting walks, in the cells of its grid. */
function fillOpaqueSource(
  rt: WebgpuPagesRuntime,
  scratch: VsmFrameScratch,
  views: GPUTextureView[],
) {
  const { lights, gpu } = rt
  const source = scratch.opaque
  source.depth = gpu.depthView!
  source.normalRough = views[1]
  source.flags = views[3]
  source.subsurface = gpu.surfaces!.subsurfaceView
  source.lobes = gpu.surfaces!.lobesView
  // The local lights' pass walks the lights the lighting walks, in the cells of its grid.
  source.deferredView = gpu.deferred!.uniform
  source.directLights = lights.buffer
  source.tileLights = lights.tiles?.buffer
  source.gridCells =
    lights.tiles && lights.tiles.tilesX * lights.tiles.tilesY * LIGHT_SETTINGS.gridSlices
  return source
}

/** The classic shadows' lights are shaded by the strands too (the strands' deep shadow or voxels, laid on the maps'): a layer a light. */
function classicHairShadow(
  { rt, device, cam, plan }: VsmFrame,
  context: NonNullable<ReturnType<typeof projectionContext>>,
  steps: ComputeRun,
  normals: GPUTextureView,
) {
  if (!context.classic) return undefined
  hairLightIds.length = context.lights.length
  for (let k = 0; k < context.lights.length; k++) hairLightIds[k] = plan.projected[k].id
  return encodeHairSurfaceShadow(rt, device, steps, cam, hairLightIds, normals)
}

/** The projection's target: the masks it writes, the light grid, the strands' shadow and the capsules' layers. */
function fillTarget(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  steps: ComputeRun,
  scratch: VsmFrameScratch,
  context: NonNullable<ReturnType<typeof projectionContext>>,
  mask: ReturnType<typeof ensureMask>,
  grid: ReturnType<typeof vsmProjectionReserve>['lightGrid'] | undefined,
  onePass: boolean,
  hairShadow: GPUTextureView | undefined,
) {
  const target = scratch.target
  target.suns = mask.sunsView
  target.locals = mask.localsView
  target.localFormat = mask.localFormat
  target.lightGrid = grid
  target.onePass = onePass
  target.hairShadow = hairShadow
  target.capsule =
    onePass && mask.locals
      ? capsuleLocalLayers(rt, cam, steps.apart(), context.lights, sunCount(context.lights))
      : undefined
  return target
}

/** The inputs the projection hold compares to the last projection's (`vsmProjectionHold.ts`). */
function writeProjectionHold(
  { rt, cam, projection, vsm }: VsmFrame,
  context: NonNullable<ReturnType<typeof projectionContext>>,
  source: VsmProjectionSource,
  onePass: boolean,
  maxLights: number,
  gridWords: number,
) {
  const { lights, gpu } = rt
  const hold = vsm.projectionHold.inputs
  hold.view = cam.view
  hold.projection = projection
  hold.revisions = rt.run.gate.revisions
  hold.lightsEpoch = lights.store.epoch
  hold.shadowEpoch = shadowEpoch(lights)
  hold.phase = context.frameIndex
  hold.trace = vsmTraceKey(context.trace!)
  hold.size = gpu.allocatedSize
  // Zero: the one-pass projection is off, no pixel keeps a light in its mask.
  hold.maxLights = onePass ? maxLights : 0
  hold.lights = context.lights
  hold.gridCells = source.gridCells ?? 0
  hold.gridWords = gridWords
  hold.gridCulled = lightGridCulled()
  hold.cullBackfacing = readShadowSetting(rt, 'shadowCullBackfacingPixels')
}

/** Projection of the opaque surfaces: one pass, every light of the frame's context, four a layer
 *  of the engine's mask. A frame whose inputs are the last projection's, the shadow pages
 *  settled, runs none: its mask is that projection's (`vsmProjectionHold.ts`). The passes it ran:
 *  0 or 1. */
function encodeVsmProjection(
  frame: VsmFrame,
  steps: ComputeRun,
  scratch: VsmFrameScratch,
  views: GPUTextureView[],
) {
  const { rt, device, cam, projection, vsm } = frame
  const context = projectionContext(frame, scratch)
  if (!context) return 0
  const { lights, gpu } = rt
  // At the targets' size, as the scene textures are at theirs: the view rect is its
  // top-left, and a dynamic-resolution step does not remake it.
  const [width, height] = gpu.allocatedSize
  const suns = sunCount(context.lights)
  const maxLights = readShadowSetting(rt, 'shadowOnePassProjectionMaxLightsPerPixel')
  // The one-pass projection, or each shadowed local light alone, lit after the others.
  const onePass = shadowsOnePass(rt)
  const mask = ensureMask(device, vsm, width, height, {
    suns,
    onePass,
    localLights: maxLights,
    perLightLayers: Math.min(context.lights.length - suns, PER_LIGHT_MASK_LAYERS),
  })
  const source = fillOpaqueSource(rt, scratch, views)
  // The shadowed lights' grid the marking pruned, over the light grid's view part, read before the hold
  // is asked: a grid made again runs the pass.
  const gridWords = lights.tiles?.worldStart ?? 0
  const grid = gridWords ? vsmProjectionReserve(device, vsm.res).lightGrid : undefined
  const hairShadow = classicHairShadow(frame, context, steps, views[1])
  const perLight =
    !onePass && mask.perLight
      ? takePerLightPath(frame, context, source, mask.perLight, hairShadow)
      : undefined
  writeProjectionHold(frame, context, source, onePass, maxLights, gridWords)
  // What the pass writes and the light grid of a new buffer run it again.
  const held = vsm.projectionHold.held(
    mask.suns,
    mask.locals ?? mask.perLight?.texture,
    source.tileLights,
    grid,
  )
  // A capsule shadow moves with its object, and the strands' with them: the masks they are taken into are projected again, not held.
  // The first-person pixels' own shadow follows the first-person objects: the masks are projected again, not held.
  const selfShadow = suns > 0 && firstPersonSelfShadowOn(rt, vsm.state.maps.shadows)
  const standing =
    held && !shadowsUnsettled(lights) && !capsuleCastsDirect(rt) && !hairShadow && !selfShadow
  // The per-light path is held with the projection: its lights are traced again where it is not.
  if (!standing) perLight?.markStale()
  const hair = gpu.hair?.visible?.shadow
  if (standing && !hair) releaseVsmHairProjection(vsm.res)
  if (standing && (!hair || vsmHairMasks(vsm.res))) return 0
  const target = fillTarget(rt, cam, steps, scratch, context, mask, grid, onePass, hairShadow)
  const hairMasks = encodeVsmHairProjection(steps, vsm.res, context, source, target, hair)
  if (standing) return hairMasks ? 1 : 0
  if (!encodeVirtualShadowProjection(steps, vsm.res, context, source, target)) return 0
  if (suns) encodeCapsuleSunMasks(rt, cam, steps.apart(), context.lights, suns, mask.sunsView)
  if (selfShadow)
    encodeFirstPersonSelfShadow(
      rt,
      steps.apart(),
      vsm.state.maps.shadows,
      context.lights,
      suns,
      mask.sunsView,
      views,
    )
  vsm.projectionHold.keep()
  return 1
}

/** The projection `encodeVsmFrame` held, encoded now that the depth pyramid holds this image's depth and
 *  its transparents' front (`encodeDepthPyramid`), which its screen rays march; none where none was held. */
export function encodeHeldVsmProjection(rt: WebgpuPagesRuntime, steps: ComputeRun) {
  const vsm = rt.lights.vsm,
    scratch = vsm?.frameScratch,
    held = scratch?.held
  if (!vsm || !scratch) return
  scratch.projecting = false
  // The per-light lights are those of the frame that takes the path (`takePerLightPath`).
  if (vsm.res.projection?.perLight) vsm.res.projection.perLight.frame = undefined
  if (!held) return
  scratch.held = undefined
  vsm.stats.projectionPasses = encodeVsmProjection(held.frame, steps, scratch, held.views)
}
