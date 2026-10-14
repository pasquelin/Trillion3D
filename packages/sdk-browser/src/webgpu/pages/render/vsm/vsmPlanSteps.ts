// The steps of the frame's shadow-map plan (`vsmPlan.ts`, `planVsmFrame`): the set held for the
// frame's lights, the casters' residency followed, and the lights' mask channels.
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import type { planVirtualShadowFrame, VsmFrameLight } from '../../../../vsm/frameSetup.ts'
import { noteResidenceChange } from '../../../shadow/bounds.ts'
import { directionalCount, fullMapsFor } from './engineVsm.ts'
import { grantEngineVsm } from './vsmGrant.ts'
import { growEngineVsm, regrowEngineVsm } from './vsmRegrow.ts'
import { reserveProjection } from './vsmBeside.ts'

type Lights = WebgpuPagesRuntime['lights']
type Vsm = NonNullable<Lights['vsm']>

/** The plan's mask channel of each light id, emptied each frame (`assignChannels`). */
const channels = new Map<string, number>()

/** The set that holds the frame's maps, its projection reserved; undefined when none can. More
 *  maps or suns than the tables hold: grown in place, else the set made again. */
export function heldVsm(rt: WebgpuPagesRuntime, device: GPUDevice, list: VsmFrameLight[]) {
  let vsm = rt.lights.vsm
  const wanted = fullMapsFor(list)
  const short =
    !!vsm && (vsm.res.layout.fullMapCapacity < wanted || vsm.suns < directionalCount(list))
  if (!vsm || (short && !growEngineVsm(device, list, vsm, wanted)))
    vsm = grantEngineVsm(rt, device, list, wanted)
  else if (!short) vsm = regrowEngineVsm(rt, device, list, vsm)
  return vsm && reserveProjection(rt, device, vsm, list) ? vsm : undefined
}

/** The casters' residency changes since the last frame; the placements come to rest are their rows'
 *  (`../encodeDraws.ts`, `followShadowRows`). */
export function followCasters(rt: WebgpuPagesRuntime) {
  const { lights } = rt
  // Residency changed since the last frame: a cluster that entered or left is another caster;
  // its box joins the change list at once, as the old scheduler's did (#831).
  const { rows, recordOf, selectionRoots, placement } = rt.layout
  lights.residence.flush(rows.residency, (page) =>
    noteResidenceChange(lights, selectionRoots, placement, page, recordOf(page)!, undefined, true),
  )
}

/** Mask channels, in the plan's light order; every other light reads no shadow. */
export function assignChannels(
  store: Lights['store'],
  vsm: Vsm,
  plan: ReturnType<typeof planVirtualShadowFrame>,
) {
  channels.clear()
  for (let k = 0; k < plan.lights.length; k++) channels.set(plan.lights[k].id, k)
  // i32 words on the GPU: −1 (no map) is 0xFFFFFFFF.
  if (vsm.lightIdsData.length < store.count) vsm.lightIdsData = new Uint32Array(store.count * 2)
  vsm.lightIdsData.fill(0xffffffff)
  for (let slot = 0; slot < store.count; slot++) {
    const id = store.ids[slot],
      k = channels.get(id)
    // `params.y` = first VSM id · 64 + mask channel (`directShadowWgsl`); past 64 shadowed
    // lights a light reads no shadow.
    store.assignSlice(slot, k !== undefined && k < 64 ? plan.lights[k].firstId * 64 + k : -1)
    if (k !== undefined) vsm.lightIdsData[slot] = plan.lights[k].firstId
  }
}
