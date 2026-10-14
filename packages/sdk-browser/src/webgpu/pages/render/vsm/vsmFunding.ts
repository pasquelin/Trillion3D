// What the virtual shadow maps ask of the GPU budget before the frame makes them: their mask with
// the frame targets, the set the first lit frame draws, reserved before the pools grant themselves.
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { castingCount, directionalCount, fullMapsFor } from './vsmLightMaps.ts'
import { ensureMask, maskBytes, maskGrowth, maskLayersFor } from './vsmMask.ts'
import { ledgerTentative } from '../../../../gpu/core/deviceLedger.ts'
import { deviceWaiting } from '../../../../gpu/core/refusal.ts'
import { vsmSetBytes } from './vsmBeside.ts'
import { shadowHeldBytes } from './vsmStats.ts'
import { shadowRowBytes } from '../../../shadow/rowBuffers.ts'
import { castingLights, frameLights } from './vsmPlan.ts'

/** Lights the frame shadows (`castingCount`), seen from the last image (`frameLights`): what its
 *  mask is funded and made for. None while the store is unlit. */
const shadowedLights = (rt: WebgpuPagesRuntime) =>
  castingLights(rt) && castingCount(frameLights(rt, 'reserve'))

/**
 * WHAT THE VIRTUAL SHADOW MAPS ASK OF THE GPU BUDGET beside what they hold (`shadowHeldBytes`), at
 * a frame of `width` × `height`: their mask, made at that frame's size — a frame target, sized by
 * the frame —, or its growth to it, funded with the frame targets before the geometry and texture
 * pools (`fundFrameTargets`), the shadows first as the budget's split declares
 * (`splitMemoryBudget`). The set itself is drawn within the room at the first lit frame
 * (`vsmReserveBytes`) and grows back within it (`vsmRegrow.ts`); the lists and the coloured atlas
 * grow within it too. While no light casts, nothing.
 */
export function vsmAskedBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  const { vsm } = rt.lights,
    casting = shadowedLights(rt)
  if (!casting) return 0
  return vsm ? maskGrowth(vsm, width, height, casting) : maskBytes(width, height, casting)
}

/** While a light casts and no set holds its maps yet — none made, or one the next lit frame
 *  replaces by a larger one (`planVsmFrame`) —, what the set it draws (`vsmSetBytes`) takes beyond
 *  the one held, and the caster rows' shadow data while none was made (`shadowRowBytes`, made by
 *  the first frame a light casts, before its set): reserved before the pools grant themselves, so
 *  a pool never takes the room of shadows still to come — out of the pools' room only, never under
 *  their floors (`ActiveGpuMemory.shadowReserve`). None while the device's refusal of that set for
 *  these lights waits (`../../../../gpu/core/refusal.ts`). */
export function vsmReserveBytes(rt: WebgpuPagesRuntime) {
  const { vsm, vsmRefusal } = rt.lights,
    device = rt.gpu.device
  if (!device || !castingLights(rt)) return 0
  const list = frameLights(rt, 'reserve'),
    wanted = fullMapsFor(list)
  if (vsm && vsm.res.layout.fullMapCapacity >= wanted) return 0
  const refused =
    vsmRefusal &&
    deviceWaiting(vsmRefusal, rt.run.frame) &&
    vsmRefusal.wanted === wanted &&
    vsmRefusal.directional === directionalCount(list)
  if (refused) return 0
  const rows = rt.lights.spheres ? 0 : shadowRowBytes(rt.layout.rows.casterSlots)
  return Math.max(0, vsmSetBytes(rt, device, list) - shadowHeldBytes(rt)) + rows
}

/** The mask a frame of the targets in place projects into, made once they are (`grantTargets`): at
 *  their size, a layer per four casting lights, in the room their funding kept for it
 *  (`vsmAskedBytes`) — never left to a later allocation of the frame that could take it. Funded and
 *  made by the same lights. Tentative: refused, the plan asks it again (`reserveProjection`). */
export function makeVsmMask(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vsm } = rt.lights,
    casting = shadowedLights(rt)
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
