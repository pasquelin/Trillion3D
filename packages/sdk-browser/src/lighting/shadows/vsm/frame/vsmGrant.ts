// The virtual shadow maps' set, made within the room the GPU budget leaves it: a smaller physical
// page pool — coarser shadows — when memory is short, no shadow when not even its eighth fits, and
// never an allocation the budget refuses, which would stop every later frame (`deviceLedger.ts`).
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { VsmFrameLight } from '../frameSetup.ts'
import { VSM_PRESSURE_CALM_FRAMES } from '../constants.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import { deviceMadeNow } from '../../../../gpu/core/errorScope.ts'
import { halvings, outOfMemoryContext } from '../../../../session/memory/outOfMemory.ts'
import {
  budgetRefusal,
  deviceRefusal,
  refusalNow,
  retryDue,
  type Refusal,
} from '../../../../gpu/core/refusal.ts'
import { noteShadowPressure } from '../../casters/memoryGrant.ts'
import { createEngineVsm, destroyEngineVsm, releaseEngineVsm, type EngineVsm } from './engineVsm.ts'
import {
  engineVsmOptions,
  fullMapsFor,
  mapSlotsPastOf,
  sunMapsFor,
  vsmAsked,
} from './vsmLightMaps.ts'
import { vsmLayout, type VsmResourceOptions } from '../layout.ts'
import { vsmResourceBytes } from '../layoutBytes.ts'
import { vsmPoolDraw, vsmPoolFloor, vsmPoolWithin } from '../poolDraw.ts'
import { bytesBeside, heldListBytes } from './vsmBeside.ts'

/** What every reason this module gives the lights for reading no shadow starts with. */
const UNAVAILABLE = 'virtual shadow maps'

/** A set refused for the frame's lights: its refusal record (`../../../../gpu/core/refusal.ts`),
 *  the maps those lights want, and the set asked for them — an overflow regrow's, never asked again
 *  as the set that overflowed. */
export type VsmRefusal = Refusal & {
  wanted: number
  sunMaps: number
  fullMapCapacity: number
  poolPages: number
}

/** The largest pool of the halvings of `first` the device makes a set of; the set, or the last error it threw. */
function grantLargestPool(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  {
    options,
    first,
    asked,
    poolAsked,
    grownFrom,
    frame,
  }: {
    options: ReturnType<typeof engineVsmOptions>
    first: NonNullable<ReturnType<typeof vsmPoolWithin>>
    asked: ReturnType<typeof vsmLayout>
    poolAsked: number
    grownFrom: number
    frame: number
  },
): { vsm: EngineVsm; error?: undefined } | { vsm?: undefined; error: unknown } {
  const { lights } = rt
  let error: unknown
  for (const pool of halvings(first, vsmPoolDraw(options))) {
    const pages = pool.layout.poolPages
    let vsm: EngineVsm
    try {
      vsm = madeSet(rt, device, list, { ...options, poolPages: pages }, poolAsked)
    } catch (thrown) {
      error = thrown
      continue
    }
    vsm.regrowFrame = frame + VSM_PRESSURE_CALM_FRAMES
    sayGranted(rt, pages, grownFrom, poolAsked, () =>
      outOfMemoryContext('shadow', vsmResourceBytes(asked), pool),
    )
    lights.vsmRefusal = undefined
    if (lights.shadowReason?.startsWith(UNAVAILABLE)) lights.shadowReason = null
    return { vsm: (lights.vsm = vsm) }
  }
  return { error }
}

/**
 * Replaces the engine's maps by a set of `fullMapCapacity` full maps, at the most physical pages up
 * to `pagesAsked` that the budget's room holds once the frame's other shadow bytes are set aside
 * (`bytesBeside`, `vsmPoolWithin`); the set replaced is freed first, so its bytes count as room. A
 * set the device refuses — undone whole (`constructGpuResources`), or freed when its verdict comes
 * (`madeSet`) — is drawn again at half its bytes, the one rule of every pool (`halvings`), down to
 * the eighth: the lights keep casting, coarser. A pool short of the one asked is said
 * (`pool-shrunk`, `gpu-out-of-memory`) — or, when it replaces a smaller one (`grownFrom`), its
 * growth (`shadow-pool-regrown`) —, and the shadows' resolution bias is its halvings from the pool
 * asked; its fill then raises the resolution bias as the asked pool's does
 * (`VsmCacheManager.readPoolFeedback`). When none fits, the lights read no shadow, by name
 * (`pool-refused`), until the room holds the smallest pool or the lights change; when the device
 * refuses even the eighth, until its refusal's wait ends or the lights change. `mapSlotsAsked`
 * the map slots the lights' demand needs in all, when it passes the replaced set's.
 */
export function grantEngineVsm(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  fullMapCapacity: number,
  pagesAsked?: number,
  grownFrom = 0,
  mapSlotsAsked = 0,
) {
  const { lights } = rt
  const settings = vsmAsked(rt),
    poolAsked = settings.poolPages
  pagesAsked ??= poolAsked
  const heldLists = heldListBytes(lights.vsm)
  // The map slots the lights asked of the set it replaces stay asked.
  const heldSlotsPast = lights.vsm ? mapSlotsPastOf(lights.vsm.res.layout) : 0
  releaseEngineVsm(lights)
  const wanted = fullMapsFor(list),
    sunMaps = sunMapsFor(list)
  const refused = lights.vsmRefusal
  const same = refused?.wanted === wanted && refused.sunMaps === sunMaps
  // The same lights refused an overflow regrow: asked again as it was.
  if (same) fullMapCapacity = Math.max(fullMapCapacity, refused.fullMapCapacity)
  const mapSlotsPast = Math.max(heldSlotsPast, mapSlotsAsked - fullMapCapacity)
  const poolPages = same ? Math.min(pagesAsked, refused.poolPages) : pagesAsked
  const options = engineVsmOptions(
    fullMapCapacity,
    sunMaps,
    { ...settings, poolPages },
    mapSlotsPast,
  )
  const { frame } = rt.run,
    now = refusalNow()
  const refusal = (record: Refusal) => refuseSet(rt, list, fullMapCapacity, poolPages, record)
  const asked = vsmLayout(options)
  const room = ledgerRoom(device) - bytesBeside(rt, device, list, heldLists)
  if (same && !retryDue(refused, room, now)) return undefined
  const first = vsmPoolWithin(room, options)
  if (!first) {
    refuseNoPool(rt, refusal, options, asked)
    return undefined
  }
  const granted = grantLargestPool(rt, device, list, {
    options,
    first,
    asked,
    poolAsked,
    grownFrom,
    frame,
  })
  if (granted.vsm) return granted.vsm
  const { error } = granted
  // Not the budget's room, which was measured: the device refused even the floor, asked again
  // after its refusal's wait, or at once for other lights.
  refusal(deviceRefusal(now, same ? refused : undefined))
  lights.shadowReason = `${UNAVAILABLE} unavailable: ${String(error)}`
  return undefined
}

/** A granted pool said: its growth over the smaller one it replaces (`grownFrom`), else its making;
 *  `context` is read only when the making says it. */
function sayGranted(
  rt: WebgpuPagesRuntime,
  pages: number,
  grownFrom: number,
  poolAsked: number,
  context: Parameters<typeof sayPoolMade>[3],
) {
  if (grownFrom) sayPoolGrown(rt, pages, grownFrom, poolAsked)
  else sayPoolMade(rt, pages, poolAsked, context)
}

/** The budget holds no page pool for `options`, not even the smallest: the lights read no shadow, by
 *  name, until the room holds it or the lights change; `refusal` records it. */
function refuseNoPool(
  rt: WebgpuPagesRuntime,
  refusal: (record: Refusal) => void,
  options: VsmResourceOptions,
  asked: ReturnType<typeof vsmLayout>,
) {
  const smallest = { ...options, poolPages: vsmPoolFloor(options) }
  refusal(budgetRefusal(vsmResourceBytes(vsmLayout(smallest)), refusalNow()))
  rt.lights.shadowReason = `${UNAVAILABLE} refused: no page pool fits the GPU budget`
  noteShadowPressure(rt.lights.memory, 'pool-refused')
  rt.diag.engineDiagnostic(
    'gpu-out-of-memory',
    'The GPU budget holds no shadow page pool: the lights cast no shadow',
    outOfMemoryContext('shadow', vsmResourceBytes(asked)),
  )
}

/** Records `record` as the refusal of the set of `fullMapCapacity` full maps at `poolPages` for
 *  `list`: what the same lights are asked again, and when. */
function refuseSet(
  rt: WebgpuPagesRuntime,
  list: readonly VsmFrameLight[],
  fullMapCapacity: number,
  poolPages: number,
  record: Refusal,
) {
  const wanted = fullMapsFor(list),
    sunMaps = sunMapsFor(list)
  rt.lights.vsmRefusal = { ...record, wanted, sunMaps, fullMapCapacity, poolPages }
}

/**
 * The set of `options` for `list`, asked of the device as every pool is: under the out-of-memory
 * scope `grantedWithin` reads (`deviceMadeNow`), the set in hand at once — a throw refuses it at
 * once. A refusal the device's verdict says later frees the set while it is still the lights' and
 * asks the same lights half its pages at the next lit frame, the one rule (`halvings`); under the
 * eighth of the pool asked, they wait as for a refused floor.
 */
export function madeSet(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  options: VsmResourceOptions,
  asked: number,
) {
  const pages = options.poolPages ?? asked
  const made = deviceMadeNow(
    device,
    () => createEngineVsm(device, options),
    (vsm) => {
      const { lights } = rt
      if (lights.vsm !== vsm) return
      destroyEngineVsm(vsm)
      lights.vsm = undefined
      // Origin of the resource change: the shadows' set left; the next frame asks another.
      rt.run.gate.resourcesChanged()
      const { fullMapCapacity } = options
      if (pages / 2 >= vsmPoolFloor({ ...options, poolPages: asked }))
        return refuseSet(rt, list, fullMapCapacity, pages / 2, budgetRefusal(0, refusalNow()))
      refuseSet(rt, list, fullMapCapacity, pages, deviceRefusal(refusalNow()))
      lights.shadowReason = `${UNAVAILABLE} unavailable: the device refused the smallest page pool`
    },
  )
  made.poolAsked = asked
  return made
}

/** The shadows' resolution bias of a pool of `pages`: its halvings from the pool `asked`. */
function biasOf(rt: WebgpuPagesRuntime, pages: number, asked: number) {
  const halvings = Math.max(0, Math.log2(asked / pages))
  rt.lights.memory.bias = halvings
  return halvings
}

/** The pool grown again from `from` pages to `pages`, said when it grew: its bias. */
export function sayPoolGrown(rt: WebgpuPagesRuntime, pages: number, from: number, asked: number) {
  biasOf(rt, pages, asked)
  if (pages > from)
    rt.diag.engineDiagnostic(
      'shadow-pool-regrown',
      'The shadows hold a larger page pool, as the budget room or the view asked: finer shadows',
      { kind: 'info', fromPages: from, pages },
    )
}

/** The first pool, made at `pages`: one short of the pool asked said as a shrink, with `shrunk`'s
 *  context; its bias. */
function sayPoolMade(
  rt: WebgpuPagesRuntime,
  pages: number,
  asked: number,
  shrunk: () => Record<string, unknown>,
) {
  const halvings = biasOf(rt, pages, asked)
  if (halvings <= 0) return
  noteShadowPressure(rt.lights.memory, 'pool-shrunk', halvings)
  rt.diag.engineDiagnostic(
    'gpu-out-of-memory',
    'The GPU budget holds a smaller shadow page pool: coarser shadows',
    shrunk(),
  )
}
