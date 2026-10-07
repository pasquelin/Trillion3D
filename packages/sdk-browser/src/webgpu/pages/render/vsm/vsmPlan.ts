// The frame's shadow-map plan on the CPU: the lights it reads, and each shadowed light's mask
// channel and first map, before the light buffer goes up.
import type { SceneLight } from '../../../../../../sdk-core/src/index.ts'
import { LIGHT_SETTINGS } from '../../../../../../sdk-core/src/scene/light/contracts.ts'
import type { EngineCamera } from '../../../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import {
  planVirtualShadowFrame,
  vsmLightSeen,
  vsmSeenPlanes,
  type VsmFrameLight,
} from '../../../../vsm/frameSetup.ts'
import { FRUSTUM_PLANE_VALUES } from '../../../../../../math/src/geometry/frustum/frustum.ts'
import { QUARTER_PI } from '../../../../../../math/src/constants.ts'
import type { VsmProjectionLight } from '../../../../vsm/projectionPass.ts'
import { vsmInvalidationPhaseFromShadowBoxes } from '../../../../vsm/invalidationPass.ts'
import { assignChannels, followCasters, heldVsm } from './vsmPlanSteps.ts'
import {
  directionalCount,
  ensureMask,
  fullMapsFor,
  maskBytes,
  maskGrowth,
  maskLayersFor,
  unshadowLights,
  vsmCountersOn,
  wholeTableRows,
} from './engineVsm.ts'
import { vsmInvalidationPipe } from '../../../../vsm/invalidationPass.ts'
import { vsmMarkingPipes } from '../../../../vsm/markingPass.ts'
import { vsmPageManagementPipes } from '../../../../vsm/pageManagementPass.ts'
import { vsmRasterPipe, vsmRenderComputePipes } from '../../../../vsm/renderPass.ts'
import { vsmProjectionTwin } from '../../../../vsm/projectionPass.ts'
import { ledgerTentative } from '../../../../gpu/core/deviceLedger.ts'
import { grantEngineVsm, growEngineVsm, vsmFirstSetLayout, vsmSetBytes } from './vsmGrant.ts'
import { shadowHeldBytes } from './vsmStats.ts'
import { shadowRowBytes } from '../../../shadow/rowBuffers.ts'

const seenPlanes = new Float64Array(FRUSTUM_PLANE_VALUES)
/** Each runtime's light lists, rewritten in place: the plan's, and the reserve's (`vsmReserveBytes`),
 *  apart so that neither rewrites the other's while it is read. */
const LISTS = new WeakMap<WebgpuPagesRuntime, { plan: VsmFrameLight[]; reserve: VsmFrameLight[] }>()

/** The light store as the frame plan reads it, into `lights`: every declared light, at its slot.
 *  Seen from `cam`, a local light no lit point of the frame is in reach of is not `visible`
 *  (`vsmLightSeen`): it costs no map, no page and no projection, and its cache waits unreferenced. */
function frameLights(rt: WebgpuPagesRuntime, which: 'plan' | 'reserve', cam?: EngineCamera) {
  let lists = LISTS.get(rt)
  if (!lists) LISTS.set(rt, (lists = { plan: [], reserve: [] }))
  const lights = lists[which]
  const { store } = rt.lights,
    size = rt.gpu.targetSize
  const planes = cam && vsmSeenPlanes(seenPlanes, cam.view, cam.projection, size[0], size[1])
  let count = 0
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot])
    if (!light) continue
    const entry = (lights[count++] ??= { light, visible: true })
    entry.light = light
    entry.visible = !planes || vsmLightSeen(light, planes)
  }
  lights.length = count
  return lights
}

/** Lights the frame's plan shadows (`castingCount`), counted on the store: none while it is
 *  unlit. */
export function castingLights(rt: WebgpuPagesRuntime) {
  const { store } = rt.lights
  let count = 0
  if (!store.unlit)
    for (let slot = 0; slot < store.count; slot++)
      if (store.light(store.ids[slot])?.castsShadow) count++
  return count
}

/**
 * WHAT THE VIRTUAL SHADOW MAPS ASK OF THE GPU BUDGET beside what they hold (`shadowHeldBytes`), at
 * a frame of `width` × `height`: their mask, made at that frame's size — a frame target, sized by
 * the frame —, or its growth to it, funded with the frame targets before the geometry and texture
 * pools (`fundFrameTargets`), the shadows first as the budget's split declares
 * (`splitMemoryBudget`). The set itself is drawn within the room at the first lit frame
 * (`vsmReserveBytes`) and grows back within it (`vsmGrant.ts`); the lists and the coloured atlas
 * grow within it too. While no light casts, nothing.
 */
export function vsmAskedBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  const { vsm } = rt.lights,
    casting = castingLights(rt)
  if (!casting) return 0
  return vsm ? maskGrowth(vsm, width, height, casting) : maskBytes(width, height, casting)
}

/** While a light casts and no set holds its maps yet — none made, or one the next lit frame
 *  replaces by a larger one (`planVsmFrame`) —, what the set it draws (`vsmSetBytes`) takes beyond
 *  the one held, and the caster rows' shadow data while none was made (`shadowRowBytes`, made by
 *  the first frame a light casts, before its set): reserved before the pools grant themselves, so
 *  a pool never takes the room of shadows still to come — out of the pools' room only, never under
 *  their floors (`ActiveGpuMemory.shadowReserve`). None once the device refused that set for these
 *  lights. */
export function vsmReserveBytes(rt: WebgpuPagesRuntime) {
  const { vsm, vsmRefusal } = rt.lights,
    device = rt.gpu.device
  if (!device || !castingLights(rt)) return 0
  const list = frameLights(rt, 'reserve'),
    wanted = fullMapsFor(list)
  if (vsm && vsm.res.layout.fullMapCapacity >= wanted) return 0
  const refused =
    vsmRefusal?.retryAt === Infinity &&
    vsmRefusal.wanted === wanted &&
    vsmRefusal.directional === directionalCount(list)
  if (refused) return 0
  const rows = rt.lights.spheres ? 0 : shadowRowBytes(rt.layout.rows.casterSlots)
  return Math.max(0, vsmSetBytes(rt, device, list) - shadowHeldBytes(rt)) + rows
}

/** The mask a frame of the targets in place projects into, made once they are (`grantTargets`):
 *  at their size, a layer per four casting lights, in the room their funding kept for it
 *  (`vsmAskedBytes`) — never left to a later allocation of the frame that could take it. Funded
 *  and made by the same lights. Tentative: refused, the plan asks it again (`reserveProjection`). */
export function makeVsmMask(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vsm } = rt.lights,
    casting = castingLights(rt)
  if (!vsm || !casting) return
  const [width, height] = rt.gpu.allocatedSize
  try {
    ledgerTentative(device, () =>
      ensureMask(device, vsm, width, height, maskLayersFor(casting), true),
    )
  } catch {
    // The room went elsewhere since the funding: the plan's own check says so, once.
  }
}

/**
 * The shadow maps' pipelines for the set the scene's casting lights are first granted
 * (`vsmFirstSetLayout`: their maps at the full pool), described here and compiled off the thread
 * before the first frame (`prepareShadowPipelines` awaits the compiles returned): every compute pipe
 * of the passes (`vsmComputePipe`), the raster's render pipeline on the shadow page group and the
 * projection's twin. That frame compiles none of them unless the budget grants a smaller pool, or
 * other lights a larger set. Nothing while no light casts.
 */
export function prepareVsmPipelines(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const pageLayout = rt.lights.pageLayout
  if (!castingLights(rt) || !pageLayout) return []
  const layout = vsmFirstSetLayout(device, frameLights(rt, 'reserve'))
  const marking = vsmMarkingPipes(device, layout),
    render = vsmRenderComputePipes(device, layout)
  const pipes = [
    vsmInvalidationPipe(device, layout),
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
  const cone = light.coneAngle ?? QUARTER_PI
  return {
    type: light.kind === 'spot' ? 'spot' : 'point',
    mapId: firstId,
    direction,
    position: light.position,
    radius: light.range,
    sourceRadius: light.emitterRadius ?? 0,
    outerConeAngle: cone,
    innerConeAngle: cone * (1 - (light.penumbra ?? 0)),
  }
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
  followCasters(rt, device)
  // The invalidations: the world's change boxes against the PREVIOUS frame's maps,
  // read before the plan gives this frame its ids. Representation changes held for the camera to
  // rest enter now: they invalidate at once.
  const changes = lights.changes
  changes.releaseDeferred()
  const boxes = vsmInvalidationPhaseFromShadowBoxes(state.cache, changes)
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
  vsm.prevSlots = prevSlots
  assignChannels(store, vsm, plan)
  return true
}
