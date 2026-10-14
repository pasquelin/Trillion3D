// The virtual shadow maps' set, made within the room the GPU budget leaves it: a smaller physical
// page pool — coarser shadows — when memory is short, no shadow when not even its eighth fits, and
// never an allocation the budget refuses, which would stop every later frame (`deviceLedger.ts`).
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import type { VsmFrameLight } from '../../../../vsm/frameSetup.ts'
import { VSM_PRESSURE_CALM_FRAMES, VSM_POOL_PAGES } from '../../../../vsm/constants.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import { deviceMadeNow } from '../../../../gpu/core/errorScope.ts'
import { halvings, outOfMemoryContext } from '../../../../residency/outOfMemory.ts'
import {
  budgetRefusal,
  deviceRefusal,
  retryDue,
  type Refusal,
} from '../../../../gpu/core/refusal.ts'
import { noteShadowPressure } from '../../../shadow/memoryGrant.ts'
import {
  createEngineVsm,
  destroyEngineVsm,
  directionalCount,
  engineVsmOptions,
  fullMapsFor,
  type EngineVsm,
} from './engineVsm.ts'
import { vsmLayout, type VsmResourceOptions } from '../../../../vsm/layout.ts'
import { vsmResourceBytes } from '../../../../vsm/layoutBytes.ts'
import { vsmPoolDraw, vsmPoolFloor, vsmPoolWithin } from '../../../../vsm/poolDraw.ts'
import { bytesBeside, heldBeside } from './vsmBeside.ts'

/** What every reason this module gives the lights for reading no shadow starts with. */
const UNAVAILABLE = 'virtual shadow maps'

/** A set refused for the frame's lights: its refusal record (`../../../../gpu/core/refusal.ts`), the
 *  maps those lights want, and the set asked for them — an overflow regrow's, never asked again as
 *  the set that overflowed. */
export type VsmRefusal = Refusal & {
  wanted: number
  directional: number
  fullMapCapacity: number
  poolPages: number
}

/**
 * Replaces the engine's maps by a set of `fullMapCapacity` full maps, at the most physical pages
 * up to `pagesAsked` that the budget's room holds once the frame's other shadow bytes are set
 * aside (`bytesBeside`, `vsmPoolWithin`); the set replaced is freed first, so its bytes count as
 * room. A set the device refuses — undone whole (`constructGpuResources`), or freed when its
 * verdict comes (`madeSet`) — is drawn again at half its bytes, the one rule of every pool
 * (`halvings`), down to the eighth: the lights keep casting, coarser. A pool short of the full one is said (`pool-shrunk`, `gpu-out-of-memory`) — or, when it
 * replaces a smaller one (`grownFrom`), its growth (`shadow-pool-regrown`) —, and the shadows'
 * resolution bias is its halvings from the full pool; its fill then raises the resolution bias as
 * the full pool's does (`VsmCacheManager.readPoolFeedback`). When none fits, the lights read no
 * shadow, by name (`pool-refused`), until the room holds the smallest pool or the lights change;
 * when the device refuses even the eighth, until its refusal's wait ends or the lights change.
 */
export function grantEngineVsm(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  fullMapCapacity: number,
  pagesAsked = VSM_POOL_PAGES,
  grownFrom = 0,
) {
  const { lights, diag } = rt
  const held = heldBeside(lights.vsm)
  if (lights.vsm) destroyEngineVsm(lights.vsm)
  lights.vsm = undefined
  const wanted = fullMapsFor(list),
    directional = directionalCount(list)
  const refused = lights.vsmRefusal
  const same = refused?.wanted === wanted && refused.directional === directional
  // The same lights refused an overflow regrow: asked again as it was.
  if (same) fullMapCapacity = Math.max(fullMapCapacity, refused.fullMapCapacity)
  const poolPages = same ? Math.min(pagesAsked, refused.poolPages) : pagesAsked
  const options = engineVsmOptions(fullMapCapacity, directional, poolPages)
  const { frame } = rt.run
  const refusal = (record: Refusal) => refuseSet(rt, list, fullMapCapacity, poolPages, record)
  const asked = vsmLayout(options)
  const room = ledgerRoom(device) - bytesBeside(rt, device, list, asked, held)
  if (same && !retryDue(refused, room, frame)) return undefined
  const first = vsmPoolWithin(room, options)
  if (!first) {
    const smallest = { ...options, poolPages: vsmPoolFloor(options) }
    refusal(budgetRefusal(vsmResourceBytes(vsmLayout(smallest)), frame))
    lights.shadowReason = `${UNAVAILABLE} refused: no page pool fits the GPU budget`
    noteShadowPressure(lights.memory, 'pool-refused')
    diag.engineDiagnostic(
      'gpu-out-of-memory',
      'The GPU budget holds no shadow page pool: the lights cast no shadow',
      outOfMemoryContext('shadow', vsmResourceBytes(asked)),
    )
    return undefined
  }
  let error: unknown
  for (const pool of halvings(first, vsmPoolDraw(options))) {
    const pages = pool.layout.poolPages
    let vsm: EngineVsm
    try {
      vsm = madeSet(rt, device, list, { ...options, poolPages: pages })
    } catch (thrown) {
      error = thrown
      continue
    }
    vsm.regrowFrame = frame + VSM_PRESSURE_CALM_FRAMES
    sayPool(rt, pages, grownFrom, () => outOfMemoryContext('shadow', vsmResourceBytes(asked), pool))
    lights.vsmRefusal = undefined
    if (lights.shadowReason?.startsWith(UNAVAILABLE)) lights.shadowReason = null
    return (lights.vsm = vsm)
  }
  // Not the budget's room, which was measured: the device refused even the floor, asked again
  // after its refusal's wait, or at once for other lights.
  refusal(deviceRefusal(frame, same ? refused : undefined))
  lights.shadowReason = `${UNAVAILABLE} unavailable: ${String(error)}`
  return undefined
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
    directional = directionalCount(list)
  rt.lights.vsmRefusal = { ...record, wanted, directional, fullMapCapacity, poolPages }
}

/**
 * The set of `options` for `list`, asked of the device as every pool is: under the out-of-memory
 * scope `grantedWithin` reads (`deviceMadeNow`), the set in hand at once — a throw refuses it at
 * once. A refusal the device's verdict says later frees the set while it is still the lights' and
 * asks the same lights half its pages at the next lit frame, the one rule (`halvings`); under the
 * eighth of the full pool, they wait as for a refused floor.
 */
export function madeSet(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  options: VsmResourceOptions,
) {
  const pages = options.poolPages ?? VSM_POOL_PAGES
  return deviceMadeNow(
    device,
    () => createEngineVsm(device, options),
    (vsm) => {
      const { lights } = rt,
        { frame } = rt.run
      if (lights.vsm !== vsm) return
      destroyEngineVsm(vsm)
      lights.vsm = undefined
      // Origin of the resource change: the shadows' set left; the next frame asks another.
      rt.run.gate.resourcesChanged()
      const { fullMapCapacity } = options
      if (pages / 2 >= vsmPoolFloor({ ...options, poolPages: VSM_POOL_PAGES }))
        return refuseSet(rt, list, fullMapCapacity, pages / 2, budgetRefusal(0, frame))
      refuseSet(rt, list, fullMapCapacity, pages, deviceRefusal(frame))
      lights.shadowReason = `${UNAVAILABLE} unavailable: the device refused the smallest page pool`
    },
  )
}

/** The pool made at `pages`: a growth from `grownFrom` pages said as one, a pool short of the
 *  full one said as a shrink; the shadows' resolution bias, its halvings from the full pool. */
export function sayPool(
  rt: WebgpuPagesRuntime,
  pages: number,
  grownFrom: number,
  shrunk: () => Record<string, unknown>,
) {
  const { memory } = rt.lights
  const halvings = Math.log2(VSM_POOL_PAGES / pages)
  memory.bias = halvings
  if (grownFrom && pages > grownFrom)
    rt.diag.engineDiagnostic(
      'shadow-pool-regrown',
      'The GPU budget holds a larger shadow page pool again: finer shadows',
      { kind: 'info', fromPages: grownFrom, pages },
    )
  else if (!grownFrom && halvings > 0) {
    noteShadowPressure(memory, 'pool-shrunk', halvings)
    rt.diag.engineDiagnostic(
      'gpu-out-of-memory',
      'The GPU budget holds a smaller shadow page pool: coarser shadows',
      shrunk(),
    )
  }
}
