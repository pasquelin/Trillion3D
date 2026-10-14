// A held shadow set grown in place — its tables, for more maps — or made again larger once the
// budget's room holds a larger pool than pressure left it (`vsmGrant.ts`).
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import type { VsmFrameLight } from '../../../../vsm/frameSetup.ts'
import { VSM_PRESSURE_CALM_FRAMES, VSM_POOL_PAGES } from '../../../../vsm/constants.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import {
  destroyEngineVsm,
  directionalCount,
  engineVsmBytes,
  engineVsmOptions,
  engineVsmSideBytes,
  growEngineVsmTables,
  type EngineVsm,
} from './engineVsm.ts'
import { vsmLayout } from '../../../../vsm/layout.ts'
import { vsmTableBytes } from '../../../../vsm/layoutBytes.ts'
import { vsmPoolWithin } from '../../../../vsm/poolDraw.ts'
import { bytesBeside, heldBeside } from './vsmBeside.ts'
import { grantEngineVsm, madeSet, sayPool } from './vsmGrant.ts'

/**
 * The held set's tables grown for `list` — `fullMapCapacity` full maps at least, the receiver
 * mask of its suns — when the budget's room holds the new tables beside the old ones
 * (`vsmTableBytes`): the pool, its pages and their cache kept, in the same frame. Past the room,
 * or refused by the device, false: the caller makes the set again (`grantEngineVsm`), its cache
 * restarting.
 */
export function growEngineVsm(
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  vsm: EngineVsm,
  fullMapCapacity: number,
) {
  const { layout } = vsm.res
  const options = engineVsmOptions(
    Math.max(fullMapCapacity, layout.fullMapCapacity),
    Math.max(vsm.suns, directionalCount(list)),
    layout.poolPages,
  )
  const grown = vsmLayout(options)
  if (vsmTableBytes(grown) > ledgerRoom(device)) return false
  try {
    return growEngineVsmTables(device, vsm, options)
  } catch {
    return false
  }
}

/**
 * A pool drawn short of the full one grows back once the budget's room holds a larger one, at
 * most every `VSM_PRESSURE_CALM_FRAMES` frames — the wait before it raises a
 * resolution the budget lowered —, and only by the pages the room holds beside what the frame
 * keeps (`bytesBeside`, the held atlas and lists as large as they are): no frame flips between
 * two pools, as a live set never shrinks. The new set is made while the held one lives when both
 * fit, and replaces it; otherwise the held one is freed first (`grantEngineVsm`), and if the device
 * refuses the larger set, the held size is made again. The cache restarts — every page drawn
 * again —, in the same frame: no frame goes without shadows.
 */
export function regrowEngineVsm(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  list: readonly VsmFrameLight[],
  vsm: EngineVsm,
): EngineVsm | undefined {
  const { layout } = vsm.res
  const pages = layout.poolPages
  if (pages >= VSM_POOL_PAGES || rt.run.frame < vsm.regrowFrame) return vsm
  vsm.regrowFrame = rt.run.frame + VSM_PRESSURE_CALM_FRAMES
  const { fullMapCapacity } = layout
  const options = engineVsmOptions(fullMapCapacity, directionalCount(list))
  const room = ledgerRoom(device)
  const beside = bytesBeside(rt, device, list, layout, heldBeside(vsm))
  const pool = vsmPoolWithin(room + engineVsmBytes(vsm) - beside, options)
  const grown = pool?.layout.poolPages ?? 0
  if (grown <= pages) return vsm
  const { lights } = rt
  if (pool!.allocatedBytes + engineVsmSideBytes(device.limits) <= room)
    try {
      const made = madeSet(rt, device, list, { ...options, poolPages: grown })
      made.regrowFrame = vsm.regrowFrame
      destroyEngineVsm(vsm)
      sayPool(rt, grown, pages, () => ({}))
      return (lights.vsm = made)
    } catch {
      return vsm
    }
  // Freed first: the larger set, else the held size again, neither held back by a refusal.
  lights.vsmRefusal = undefined
  let made = grantEngineVsm(rt, device, list, fullMapCapacity, VSM_POOL_PAGES, pages)
  if (!made) {
    lights.vsmRefusal = undefined
    made = grantEngineVsm(rt, device, list, fullMapCapacity, pages, pages)
  }
  return made
}
