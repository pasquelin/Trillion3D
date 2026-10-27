// The steps of the frame's shadow-map plan (`vsmPlan.ts`, `planVsmFrame`): the set held for the
// frame's lights, and the lights' projection records.
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { planVirtualShadowFrame, VsmFrameLight } from '../frameSetup.ts'
import { askedOfLayout, fullMapsFor, sunMapsFor, vsmAsked } from './vsmLightMaps.ts'
import { dynamicHzbOf } from '../layout.ts'
import { grantEngineVsm } from './vsmGrant.ts'
import { growEngineVsm, regrowEngineVsm } from './vsmRegrow.ts'
import { reserveProjection } from './vsmBeside.ts'
import { shadowSliceOf } from '../../../direct/shadowSlice.ts'
import { VSM_MIPS } from '../constants.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../projection/projectionView.ts'

type Lights = WebgpuPagesRuntime['lights']
type Vsm = NonNullable<Lights['vsm']>

/** The plan's mask channel of each light id, emptied each frame (`assignChannels`). */
const channels = new Map<string, number>()

/** The set that holds the frame's maps, its projection reserved; undefined when none can. More
 *  maps or suns than the tables hold: grown in place, else the set made again. */
export function heldVsm(rt: WebgpuPagesRuntime, device: GPUDevice, list: VsmFrameLight[]) {
  let vsm = rt.lights.vsm
  const wanted = fullMapsFor(list)
  const short = !!vsm && (vsm.res.layout.fullMapCapacity < wanted || vsm.sunMaps < sunMapsFor(list))
  const asked = vsmAsked(rt),
    kept = vsm && askedOfLayout(vsm.res.layout)
  // The pool size the setting asks moved: the pool is made again and its pages dropped, as the
  // reference makes a pool whose size changed again.
  const poolMoved = !!vsm && vsm.poolAsked !== asked.poolPages
  // The occlusion culling turned on or off, or its second layer, the pages kept from one frame to
  // the next (`shadowCache`) turned on or off, or the cover of the local lights' receivers
  // (`shadowUseReceiverMaskLocal`) asked where the set's cover holds the suns' alone: the set made
  // again, with its pyramid or without, its pages and cache drawn again. A cover that holds every
  // map still works with the option off.
  const moved =
    !!kept &&
    (kept.occlusion !== asked.occlusion ||
      kept.dynamicHzb !== dynamicHzbOf(asked.occlusion, asked.cacheEnabled, asked.dynamicHzb) ||
      kept.cacheEnabled !== asked.cacheEnabled ||
      (asked.localCover && !kept.localCover))
  if (!vsm || moved || poolMoved || (short && !growEngineVsm(device, list, vsm, wanted)))
    vsm = grantEngineVsm(rt, device, list, wanted)
  else if (!short) vsm = regrowEngineVsm(rt, device, list, vsm)
  return vsm && reserveProjection(rt, device, vsm, list) ? vsm : undefined
}

/** The projection record of each shadowed light, in the plan's light order (`plan.projected`): the
 *  suns' first, their rank their layer in the suns' mask; every other light reads no shadow. */
export function assignChannels(
  store: Lights['store'],
  vsm: Vsm,
  plan: ReturnType<typeof planVirtualShadowFrame>,
) {
  channels.clear()
  const records = Math.min(plan.projected.length, VSM_PROJECTION_MAX_PASS_LIGHTS)
  for (let k = 0; k < records; k++) channels.set(plan.projected[k].id, k)
  // i32 words on the GPU: −1 (no map) is 0xFFFFFFFF.
  if (vsm.lightIdsData.length < store.count) vsm.lightIdsData = new Uint32Array(store.count * 2)
  vsm.lightIdsData.fill(0xffffffff)
  for (let slot = 0; slot < store.count; slot++) {
    const id = store.ids[slot],
      k = channels.get(id)
    // `params.y` = the record's rank and the light's two flags (`shadowSliceOf`).
    if (k === undefined) {
      store.assignSlice(slot, -1)
      continue
    }
    const light = plan.projected[k]
    store.assignSlice(
      slot,
      shadowSliceOf(
        k,
        light.kind === 'directional',
        light.entry.mapCaches[0].projectionData.finestMip >= VSM_MIPS - 1,
      ),
    )
    vsm.lightIdsData[slot] = light.firstId
  }
}
