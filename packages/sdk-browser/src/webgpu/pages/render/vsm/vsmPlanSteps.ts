// The steps of the frame's shadow-map plan (`vsmPlan.ts`, `planVsmFrame`): the set held for the
// frame's lights, the casters' residency and mobility followed, and the lights' mask channels.
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { VSM_STILL_FRAMES } from '../../../../vsm/constants.ts'
import type { planVirtualShadowFrame, VsmFrameLight } from '../../../../vsm/frameSetup.ts'
import { noteResidenceChange, uploadRowMobility } from '../../../shadow/bounds.ts'
import { composedSlotBox } from '../../../../placement/composeBoxes.ts'
import { directionalCount, fullMapsFor } from './engineVsm.ts'
import { grantEngineVsm, growEngineVsm, regrowEngineVsm, reserveProjection } from './vsmGrant.ts'

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

/** The casters' changes since the last frame: residency, and placements come to rest. */
export function followCasters(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights } = rt
  // Residency changed since the last frame: a cluster that entered or left is another caster;
  // its box joins the change list at once, as the old scheduler's did (#831).
  const { rows, recordOf, selectionRoots, placement } = rt.layout
  lights.residence.flush(rows.residentFlags, (page) =>
    noteResidenceChange(
      lights,
      selectionRoots,
      placement.rootOfPacked,
      page,
      recordOf(page)!,
      undefined,
      true,
    ),
  )
  // The cached-as-dynamic update: a placement at rest past the static threshold frames
  // caches as static again; its box invalidates the static pages it now belongs to — a follower
  // of a parent composed on the GPU, its slot's box where the parent now holds it.
  const settled = lights.mobility.settle(VSM_STILL_FRAMES, (rank, lead) => {
    const box = lead >= 0 ? composedSlotBox(rt, lead) : rt.layout.selectionRoots[rank]?.worldBox
    if (box) lights.changes.worldChanged(box.subarray(0, 3), box.subarray(3, 6), false)
  })
  if (settled) uploadRowMobility(rt, device, 0, -1)
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
