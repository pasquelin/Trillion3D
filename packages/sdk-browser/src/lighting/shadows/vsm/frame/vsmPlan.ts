// The frame's shadow-map plan on the CPU: the lights it reads, and each shadowed light's mask
// channel and first map, before the light buffer goes up.
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_SETTINGS } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { sourceRadiusOf, spotConesOf } from '../../../../../../sdk-core/src/scene/light/fields.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { planVirtualShadowFrame } from '../frameSetup.ts'
import { vsmLightSeen, vsmSeenPlanes } from '../seenLights.ts'
import { vsmLocalShadowGate, type VsmGateView } from '../localGate.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../../../../math/src/geometry/frustum/frustum.ts'
import type { VsmProjectionLight } from '../projection/projectionPass.ts'
import { vsmCastBoxes } from '../invalidation/castBoxes.ts'
import { settingsRevision } from '../../../../../../sdk-core/src/contracts/settingRules.ts'
import { createViewFingerprint } from '../../../../frame/view/viewFingerprint.ts'
import { assignChannels, followCasters, heldVsm } from './vsmPlanSteps.ts'
import { sunCascadesOf, vsmFirstPersonActive, vsmMapSettings } from './vsmFarShadow.ts'
import { shadowsOn, tracesTranslucent } from './vsmGates.ts'
import { vsmSunLevels } from '../mapSettings.ts'
import { dropEngineVsmCache, releaseEngineVsm, unshadowLights, vsmCountersOn } from './engineVsm.ts'
import { wholeTableRows } from './vsmLightMaps.ts'
import { VSM_OVERFLOW_MAP_SLOTS } from '../constants.ts'
import { nextPow2 } from '../../../../../../math/src/scalar/integers.ts'
import { vsmCastMaps } from '../invalidation/castInvalidation.ts'
import { vsmCastPipes } from '../invalidation/castStale.ts'
import { vsmMarkingPipes } from '../markingPass.ts'
import { vsmPageManagementPipes } from '../pageManagementPass.ts'
import { vsmOcclusionPipes } from '../occlusion/occlusionPass.ts'
import { vsmRasterPipe, vsmRenderComputePipes, vsmSoftwarePipes } from '../render/renderPipes.ts'
import { vsmDescentPipes } from '../traversal/traversalPass.ts'
import type { VsmLayout } from '../layout.ts'
import { vsmRenderTiersDrawn, type CompiledTiers } from '../render/renderParamsWgsl.ts'
import { chainReady, type PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { marksWaterSurface, viewMarkingOf } from './vsmFrontLayer.ts'
import { vsmProjectionPipeline } from '../projection/projectionPipelines.ts'
import { onePassMaskFormat } from '../projection/maskFormat.ts'
import { readShadowSetting } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { grantEngineVsm } from './vsmGrant.ts'
import { followDepthOfField } from './vsmDof.ts'
import { growEngineVsm } from './vsmRegrow.ts'
import { vsmFirstSetLayout } from './vsmBeside.ts'
import { castDiffStages, followRoots, prepareCastDiff } from '../../casters/castDiff.ts'
import { prepareCasterDecode } from '../../casters/casterFeed.ts'

const seenPlanes = new Float64Array(FRUSTUM_PLANE_VALUES)
/** The view the local lights' shadow gate reads (`vsmLocalShadowGate`), rewritten by each call. */
const gateView: VsmGateView = { projection: [], eye: [], width: 0, height: 0 }

/** What a frame's lights were last read from, by list: the store's revision, the shadow settings'
 *  revision, the view and the scene's distance fields; the same asks the same lights again. */
type LightsRead = {
  epoch: number
  settings: number
  fields: boolean
  seen: ReturnType<typeof createViewFingerprint> | undefined
}
const lightsRead = new WeakMap<object, LightsRead>()

/** The light store as the frame plan reads it, into `lights`: every declared light, at its slot.
 *  Seen from `cam` — the plan's, else the last image's —, a local light no lit point of the frame
 *  is in reach of, or whose shadow the local lights' gates take away (`vsmLocalShadowGate`), is
 *  not `visible` (`vsmLightSeen`): it costs no map, no page, no projection and no
 *  room in the tables or the mask, and its cache waits unreferenced. Before any image no local
 *  light is seen yet: the first plan grows the set for those its camera sees. A light that casts
 *  no shadow is none of that: the gate and the cascades are asked of the lights that cast alone. */
export function frameLights(
  rt: WebgpuPagesRuntime,
  which: 'plan' | 'reserve',
  cam = rt.run.lastCamera ? rt.run.gate.cam : undefined,
) {
  const lights = (rt.lights.vsmLights ??= { plan: [], reserve: [] })[which]
  const { store } = rt.lights,
    size = rt.gpu.targetSize
  const { shadows } = vsmMapSettings(rt)
  // The reading is of the store, the settings, the view and the scene's fields alone: none moved,
  // the entries stand as they were.
  const settings = settingsRevision(rt.context),
    fields = !!rt.context.distanceFields?.length
  const read = lightsRead.get(lights)
  if (
    read &&
    read.epoch === store.epoch &&
    read.settings === settings &&
    read.fields === fields &&
    (cam ? read.seen?.same(cam, size[0], size[1]) : !read.seen)
  )
    return lights
  const planes = cam && vsmSeenPlanes(seenPlanes, cam.view, cam.projection, size[0], size[1])
  if (cam) {
    gateView.projection = cam.projection
    gateView.eye = cam.eye
    gateView.width = size[0]
    gateView.height = size[1]
  }
  let count = 0
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot])
    if (!light) continue
    const entry = (lights[count++] ??= { light, visible: true })
    entry.light = light
    const casts = light.castsShadow
    entry.visible =
      casts &&
      (planes
        ? vsmLightSeen(light, planes) && vsmLocalShadowGate(light, gateView, shadows)
        : light.kind === 'directional')
    // The reserve sizes the set only: it takes no cascades.
    if (which === 'plan' && casts) {
      entry.cascades = sunCascadesOf(rt, light, cam?.near ?? 0, shadows)
      entry.farShadowEdge = entry.cascades.edge
    }
    entry.sunLevels = vsmSunLevels(shadows)
  }
  lights.length = count
  const kept = read ?? { epoch: 0, settings: 0, fields: false, seen: undefined }
  kept.epoch = store.epoch
  kept.settings = settings
  kept.fields = fields
  if (cam) (kept.seen ??= createViewFingerprint()).keep(cam, size[0], size[1])
  else kept.seen = undefined
  if (!read) lightsRead.set(lights, kept)
  return lights
}

/** Lights the store holds that cast: none while it is unlit or no light takes a shadow
 *  (`shadowsOn`). */
export function castingLights(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  let count = 0
  if (!store.unlit && shadowsOn(rt))
    for (let slot = 0; slot < store.count; slot++)
      if (store.light(store.ids[slot])?.castsShadow) count++
  return count
}

/**
 * The shadow maps' pipelines for the set the scene's casting lights are first granted
 * (`vsmFirstSetLayout`: their maps at the pool the view asks), described here and compiled off the
 * thread before the first frame (`prepareShadowPipelines` awaits the compiles returned): every
 * compute pipe of the passes (`vsmComputePipe`), the raster's render pipeline on the shadow page
 * group, the projection's opaque pipelines, the diff of the instances' boxes (`prepareCastDiff`) and the decode of the casters (`prepareCasterDecode`). That frame compiles
 * none of them unless the budget grants a smaller pool, or other lights a larger set. Nothing while
 * no light casts.
 */
export function prepareVsmPipelines(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const pageLayout = rt.lights.pageLayout
  if (!castingLights(rt) || !pageLayout) return []
  const layout = vsmFirstSetLayout(rt, frameLights(rt, 'reserve'))
  return [
    ...framePipelines(rt, device, layout, pageLayout, false).map((stage) => stage.prepare()),
    vsmProjectionPipeline(
      device,
      layout,
      onePassMaskFormat(readShadowSetting(rt, 'shadowOnePassProjectionMaxLightsPerPixel')),
    )
      .prepare()
      .then(() => undefined),
    prepareCastDiff(device),
    prepareCasterDecode(device),
  ].filter((compile): compile is Promise<void> => compile !== undefined)
}

/** The pipelines of the frame's passes over `layout`: every compute pipe of the marking, the page
 *  management, the descent, the cull, the bin, the software raster and the stale, the raster's
 *  one-sided and two-sided tiers — made from the start, so a first double-sided material waits for
 *  no compile — and the voxel rows' where the session holds voxel bricks (`voxels`). */
function framePipelines(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  layout: VsmLayout,
  pageLayout: GPUBindGroupLayout,
  voxels: boolean,
) {
  const marking = vsmMarkingPipes(device, layout),
    render = vsmRenderComputePipes(device, layout)
  const casts = vsmCastPipes(device, layout)
  const fronts = tracesTranslucent(rt) ? [false, true] : [false],
    waters = marksWaterSurface(rt) ? [false, true] : [false]
  const froxels = viewMarkingOf(rt) === 'froxels'
  const raster = vsmRasterPipe(device, layout, pageLayout, rt.vis.rasters)
  const pipes = [
    casts.args,
    casts.stale,
    marking.clear('all'),
    marking.clear('directionalOnly'),
    marking.prune(),
    marking.rect(),
    marking.coarse(),
    // The programs of the pixel pass the image can run: the one that also marks the translucent front
    // layer, where the project traces their shadow, and the ones that mark the water's surface, drawn
    // ahead of the lights where the scene has water.
    ...fronts.flatMap((front) => waters.map((water) => marking.pixels(front, water))),
    ...Object.values(vsmPageManagementPipes(device, layout, vsmCountersOn(device))).map(
      ({ pipe }) => pipe,
    ),
    // The one-sided tiers alone: the others compile the first time a table holds a row of theirs.
    ...[render.candidates, render.candidatesDone, render.views, render.cull, render.bin],
    // The software half of the raster, on the session's graphs as the raster's tiers.
    ...Object.values(vsmSoftwarePipes(device, layout, rt.vis.rasters)),
    // The shadow views' descent.
    ...descentPipes(device, layout),
    ...Object.values(render.args),
    // The occlusion's culls and its pyramid's build, where the set takes it.
    ...(layout.occlusion
      ? [
          ...[render.cullFirst, render.cullSecond, render.cullPost, render.candidatesPostDone],
          ...Object.values(vsmOcclusionPipes(device, layout)),
        ]
      : []),
    // The froxels' marking, where the setting takes it.
    ...(froxels ? [marking.froxelBuild(), marking.froxelArgs(), marking.froxelMark()] : []),
  ]
  const stages: (PreparedPipeline<unknown> | undefined)[] = [
    ...pipes.map((pipe) => pipe?.prepared),
    // The diff of the instances' boxes feeds the stale: no shadow is planned without it.
    ...castDiffStages(device),
    ...vsmRenderTiersDrawn({ twoSided: true, voxels }).map((tier) => raster.tiers[tier]),
  ]
  return stages.filter((stage) => stage !== undefined)
}

/** What a layout's pipelines were last found compiled for (`framePipelinesCompiled`); `tiers` the
 *  families the frame draws, whose `twoSided` follows the table (the pipelines of both stand). */
interface CompiledFor {
  tiers: CompiledTiers
  rasters: unknown
  translucent: boolean
  froxels: boolean
  water: boolean
  counters: boolean
}
const compiledFor = new WeakMap<VsmLayout, CompiledFor>()

/** Whether the session holds voxel bricks. */
function holdsVoxels(rt: WebgpuPagesRuntime) {
  for (const block of rt.vis.geometryBlocks.values()) if (block.voxel) return true
  return false
}

/** The families of the raster the frame draws, every pipeline of its passes over `layout` compiled
 *  (the two-sided tiers' always, the voxel tiers' where the session holds voxel bricks), or none
 *  while one compiles, the missing ones asked at once (`chainReady`): the marking, the page
 *  management, the raster and the stale write what the next read and advance the cache, so the frame
 *  plans nothing while one compiles. Compiled pipelines stay so: nothing is looked up again for the
 *  same graphs and settings. */
function framePipelinesCompiled(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  layout: VsmLayout,
): CompiledTiers | undefined {
  const pageLayout = rt.lights.pageLayout
  if (!pageLayout) return undefined
  const now: CompiledFor = {
    tiers: { twoSided: rt.vis.materialTable.twoSided, voxels: holdsVoxels(rt) },
    rasters: rt.vis.rasters,
    translucent: tracesTranslucent(rt),
    froxels: viewMarkingOf(rt) === 'froxels',
    water: marksWaterSurface(rt),
    counters: vsmCountersOn(device),
  }
  const known = compiledFor.get(layout)
  if (
    known &&
    known.rasters === now.rasters &&
    known.tiers.voxels === now.tiers.voxels &&
    known.translucent === now.translucent &&
    known.froxels === now.froxels &&
    known.water === now.water &&
    known.counters === now.counters
  ) {
    known.tiers.twoSided = now.tiers.twoSided
    return known.tiers
  }
  if (!chainReady(...framePipelines(rt, device, layout, pageLayout, now.tiers.voxels)))
    return undefined
  compiledFor.set(layout, now)
  return now.tiers
}

/** The shadow views' descent's kernels (`vsmDescentPipes`). */
function descentPipes(device: GPUDevice, layout: VsmLayout) {
  const { levels, ...rest } = vsmDescentPipes(device, layout)
  return [...Object.values(rest), ...levels]
}

/** The light as the projection pass reads it. */
export function projectionLight(
  light: SceneLight,
  firstId: number,
  firstPersonId?: number,
): VsmProjectionLight {
  const direction = light.direction ?? [0, -1, 0]
  if (light.kind === 'directional')
    return {
      type: 'directional',
      mapId: firstId,
      firstPersonMapId: firstPersonId,
      direction,
      // A sun without its own disk takes the engine's published one.
      sourceRadius: Math.sin(light.angularRadius ?? LIGHT_SETTINGS.sunAngularRadius),
    }
  // A shadowed point, spot or rectangle holds its position and range, a spot its cone
  // (`validateSceneLight`), the outer one the lighting lights it by (`spotConesOf`).
  const local = {
    mapId: firstId,
    direction,
    position: light.position!,
    radius: light.range!,
    sourceRadius: sourceRadiusOf(light),
  }
  return light.kind === 'spot'
    ? { ...local, type: 'spot', coneAngle: spotConesOf(light)[1] }
    : { ...local, type: light.kind }
}

/**
 * A frame in which no light takes a shadow (`shadowsOn`): the maps held are freed
 * (`shadowDynamicDeallocationMode` 1) or kept with their cache dropped (the casters change
 * unseen, and a later plan draws every light uncached), the representation changes held for the
 * camera to rest are released to the list (`shadowsUnsettled` waits for none) and no light reads
 * a shadow. Always false: the frame has no plan.
 */
function planNoShadows(rt: WebgpuPagesRuntime) {
  const { lights } = rt,
    { vsm } = lights
  if (vsm) {
    if (readShadowSetting(rt, 'shadowDynamicDeallocationMode') === 1) releaseEngineVsm(lights)
    else dropEngineVsmCache(vsm, rt.run.frame)
  }
  lights.changes.releaseDeferred()
  unshadowLights(lights.store)
  return false
}

/** The maps of `list` planned from `cam` over `vsm`'s state. The sun's clipmap is sized for the
 *  width this frame draws at, floored by `shadowClipmapMinCameraViewportWidth`; local lights keep
 *  the drawn size. More maps than the page table holds: twice the room, in the same frame when the
 *  tables grow in place. */
function planMaps(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  list: ReturnType<typeof frameLights>,
  vsm: NonNullable<ReturnType<typeof heldVsm>>,
) {
  const { gpu } = rt
  return planVirtualShadowFrame(
    vsm.state,
    list,
    {
      view: cam.view,
      projection: cam.projection,
      eye: cam.eye,
      perspective: cam.perspective === 1,
      // Each view keeps its suns' clipmaps, centred on its own eye.
      viewId: rt.views.active.id,
    },
    {
      width: gpu.targetSize[0],
      height: gpu.targetSize[1],
      minScreenWidth: vsm.state.maps.shadows.shadowClipmapMinCameraViewportWidth,
    },
    (maps) =>
      growEngineVsm(
        device,
        list,
        vsm,
        wholeTableRows(Math.max(maps, 2 * vsm.res.layout.fullMapCapacity + 1)),
      ),
  )
}

/**
 * Plans the frame's virtual shadow maps on the CPU and gives every shadowed light its mask
 * channel; called before the light buffer goes up. Returns false when the frame has none.
 */
export function planVsmFrame(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  if (!shadowsOn(rt)) return planNoShadows(rt)
  const { lights } = rt,
    { store } = lights
  const list = frameLights(rt, 'plan', cam)
  const vsm = heldVsm(rt, device, list)
  if (!vsm) {
    unshadowLights(store)
    return false
  }
  // The passes' pipelines compiled, or no plan: the cache advances only for a frame that runs.
  let tiers = framePipelinesCompiled(rt, device, vsm.res.layout)
  if (!tiers) {
    unshadowLights(store)
    return false
  }
  const { state } = vsm
  state.maps = vsmMapSettings(rt)
  followDepthOfField(rt, cam, state.maps.shadows.shadowMaxDofResolutionBias, state.maps.dof)
  followCasters(rt)
  // The placements that moved, came or went: the diff of their boxes, encoded before the stale.
  const diff = followRoots(rt, device, state.maps.shadows)
  // Read once the placements' words are written (`followRoots`): this frame's world-space stand-ins.
  if (state.maps.firstPerson) state.maps.firstPerson.active = vsmFirstPersonActive(rt)
  // The invalidation: the world's change boxes and the diff's shadow changes against the PREVIOUS
  // frame's maps, read before the plan gives this frame its ids — the maps only when something
  // changed. Representation changes held for the camera to rest enter now: they invalidate at once.
  const changes = lights.changes
  changes.releaseDeferred()
  const boxes = vsmCastBoxes(state.cache, changes),
    castMaps = vsmCastMaps(state.cache, boxes, lights.casts)
  changes.settled()
  const prevSlots = state.cache.prevFrame?.mapCount ?? 0
  const planned = vsm.res.layout
  const plan = planMaps(rt, device, cam, list, vsm)
  // The tables grown in place made the passes' pipelines anew: the frame waits for them too.
  if (vsm.res.layout !== planned) {
    tiers = framePipelinesCompiled(rt, device, vsm.res.layout)
    if (!tiers) {
      unshadowLights(store)
      return false
    }
  }
  const slotsShort = plan.mapsAsked > vsm.res.layout.mapSlots
  if (slotsShort) vsm.overflow.note(VSM_OVERFLOW_MAP_SLOTS, performance.now())
  if (plan.overflow) {
    // Maps past the slots: the slots grow in place, the pages and their cache kept.
    if (
      slotsShort &&
      growEngineVsm(device, list, vsm, vsm.res.layout.fullMapCapacity, nextPow2(plan.mapsAsked))
    ) {
      unshadowLights(store)
      return false
    }
    // Past the room to grow them: the slots the maps asked kept, twice the block room next frame
    // when the blocks overflowed, the cache restarts, at the pages the budget granted.
    const { fullMapCapacity, poolPages } = vsm.res.layout
    const blocksShort = !slotsShort || plan.tableBlocks > fullMapCapacity
    grantEngineVsm(
      rt,
      device,
      list,
      blocksShort ? wholeTableRows(2 * fullMapCapacity + 1) : fullMapCapacity,
      poolPages,
      0,
      nextPow2(plan.mapsAsked),
    )
    unshadowLights(store)
    return false
  }
  vsm.plan = { ...plan, tiers }
  vsm.pendingBoxes = boxes
  vsm.pendingDiff = diff
  vsm.pendingCastMaps = castMaps
  vsm.prevSlots = prevSlots
  assignChannels(store, vsm, plan)
  return true
}
