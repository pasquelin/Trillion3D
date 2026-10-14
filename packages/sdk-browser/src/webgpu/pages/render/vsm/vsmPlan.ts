// The frame's shadow-map plan on the CPU: the lights it reads, and each shadowed light's mask
// channel and first map, before the light buffer goes up.
import type { SceneLight } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_SETTINGS } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { planVirtualShadowFrame } from '../../../../vsm/frameSetup.ts'
import { vsmLightSeen, vsmSeenPlanes } from '../../../../vsm/seenLights.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../../../../math/src/geometry/frustum/frustum.ts'
import type { VsmProjectionLight } from '../../../../vsm/projectionPass.ts'
import { vsmCastBoxes } from '../../../../vsm/castBoxes.ts'
import { assignChannels, followCasters, heldVsm } from './vsmPlanSteps.ts'
import { unshadowLights, vsmCountersOn } from './engineVsm.ts'
import { wholeTableRows } from './vsmLightMaps.ts'
import { vsmCastMaps } from '../../../../vsm/castInvalidation.ts'
import { vsmCastPipes } from '../../../../vsm/castStale.ts'
import { vsmMarkingPipes } from '../../../../vsm/markingPass.ts'
import { vsmPageManagementPipes } from '../../../../vsm/pageManagementPass.ts'
import { vsmRasterPipe, vsmRenderComputePipes } from '../../../../vsm/renderPipes.ts'
import { vsmProjectionTwin } from '../../../../vsm/projectionPass.ts'
import { grantEngineVsm } from './vsmGrant.ts'
import { growEngineVsm } from './vsmRegrow.ts'
import { vsmFirstSetLayout } from './vsmBeside.ts'

const seenPlanes = new Float64Array(FRUSTUM_PLANE_VALUES)

/** The light store as the frame plan reads it, into `lights`: every declared light, at its slot.
 *  Seen from `cam` — the plan's, else the last image's —, a local light no lit point of the frame
 *  is in reach of is not `visible` (`vsmLightSeen`): it costs no map, no page, no projection and no
 *  room in the tables or the mask, and its cache waits unreferenced. Before any image no local
 *  light is seen yet: the first plan grows the set for those its camera sees. */
export function frameLights(
  rt: WebgpuPagesRuntime,
  which: 'plan' | 'reserve',
  cam = rt.run.lastCamera ? rt.run.gate.cam : undefined,
) {
  const lights = (rt.lights.vsmLights ??= { plan: [], reserve: [] })[which]
  const { store } = rt.lights,
    size = rt.gpu.targetSize
  const planes = cam && vsmSeenPlanes(seenPlanes, cam.view, cam.projection, size[0], size[1])
  let count = 0
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot])
    if (!light) continue
    const entry = (lights[count++] ??= { light, visible: true })
    entry.light = light
    entry.visible = planes ? vsmLightSeen(light, planes) : light.kind === 'directional'
  }
  lights.length = count
  return lights
}

/** Lights the store holds that cast: none while it is unlit. */
export function castingLights(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  let count = 0
  if (!store.unlit)
    for (let slot = 0; slot < store.count; slot++)
      if (store.light(store.ids[slot])?.castsShadow) count++
  return count
}

/**
 * The shadow maps' pipelines for the set the scene's casting lights are first granted
 * (`vsmFirstSetLayout`: their maps at the full pool), described here and compiled off the thread
 * before the first frame (`prepareShadowPipelines` awaits the compiles returned): every compute
 * pipe of the passes (`vsmComputePipe`), the raster's render pipeline on the shadow page group and
 * the projection's twin. That frame compiles none of them unless the budget grants a smaller pool,
 * or other lights a larger set. Nothing while no light casts.
 */
export function prepareVsmPipelines(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const pageLayout = rt.lights.pageLayout
  if (!castingLights(rt) || !pageLayout) return []
  const layout = vsmFirstSetLayout(device, frameLights(rt, 'reserve'))
  const marking = vsmMarkingPipes(device, layout),
    render = vsmRenderComputePipes(device, layout)
  const casts = vsmCastPipes(device, layout)
  const pipes = [
    casts.args,
    casts.stale,
    marking.clear('all'),
    marking.clear('directionalOnly'),
    marking.rect(),
    marking.coarse(),
    marking.pixels(),
    ...Object.values(vsmPageManagementPipes(device, layout, vsmCountersOn(device))).map(
      ({ pipe }) => pipe,
    ),
    ...[render.candidates, render.cull, render.expand],
    ...Object.values(render.args),
  ]
  return [
    ...pipes.map((pipe) => pipe?.prepared.prepare()),
    vsmRasterPipe(device, layout, pageLayout).prepared.prepare(),
    vsmProjectionTwin(device, layout).prepare(),
  ].filter((compile): compile is Promise<void> => compile !== undefined)
}

/** The light as the projection pass reads it. */
export function projectionLight(light: SceneLight, firstId: number): VsmProjectionLight {
  const direction = light.direction ?? [0, -1, 0]
  if (light.kind === 'directional')
    return {
      type: 'directional',
      mapId: firstId,
      direction,
      // A sun without its own disk takes the engine's published one.
      sourceRadius: Math.sin(light.angularRadius ?? LIGHT_SETTINGS.sunAngularRadius),
    }
  // A shadowed point or spot holds its position and range, a spot its cone (`validateSceneLight`).
  const local = {
    mapId: firstId,
    direction,
    position: light.position!,
    radius: light.range!,
    sourceRadius: light.emitterRadius ?? 0,
  }
  return light.kind === 'spot'
    ? { ...local, type: 'spot', coneAngle: light.coneAngle! }
    : { ...local, type: 'point' }
}

/**
 * Plans the frame's virtual shadow maps on the CPU and gives every shadowed light its mask
 * channel; called before the light buffer goes up. Returns false when the frame has none.
 */
export function planVsmFrame(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { lights, gpu } = rt,
    { store } = lights
  const list = frameLights(rt, 'plan', cam)
  const [width, height] = gpu.targetSize
  const vsm = heldVsm(rt, device, list)
  if (!vsm) {
    unshadowLights(store)
    return false
  }
  const { state } = vsm
  followCasters(rt)
  // The invalidation: the world's change boxes and the rows' shadow changes against the PREVIOUS
  // frame's maps, read before the plan gives this frame its ids — the maps only when something
  // changed. Representation changes held for the camera to rest enter now: they invalidate at once.
  const changes = lights.changes
  changes.releaseDeferred()
  const boxes = vsmCastBoxes(state.cache, changes),
    castMaps = vsmCastMaps(state.cache, boxes, lights.casts)
  changes.settled()
  const prevSlots = state.cache.prevFrame?.mapSlotCount ?? 0
  // The sun's clipmap is sized for the display, whatever scale this frame draws at; local lights
  // keep the drawn size.
  // More maps than the page table holds: twice the room, in the same frame when the tables grow
  // in place.
  const plan = planVirtualShadowFrame(
    state,
    list,
    {
      view: cam.view,
      projection: cam.projection,
      eye: cam.eye,
      perspective: cam.perspective === 1,
    },
    { width, height, minScreenWidth: gpu.displaySize[0] },
    (maps) =>
      growEngineVsm(
        device,
        list,
        vsm,
        wholeTableRows(Math.max(maps, 2 * vsm.res.layout.fullMapCapacity + 1)),
      ),
  )
  if (plan.overflow) {
    // Past the room to grow them: twice the room next frame, the cache restarts, at the pages
    // the budget granted.
    const { fullMapCapacity, poolPages } = vsm.res.layout
    grantEngineVsm(rt, device, list, wholeTableRows(2 * fullMapCapacity + 1), poolPages)
    unshadowLights(store)
    return false
  }
  vsm.plan = plan
  vsm.pendingBoxes = boxes
  vsm.pendingCastMaps = castMaps
  vsm.prevSlots = prevSlots
  assignChannels(store, vsm, plan)
  return true
}
