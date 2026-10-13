import { deviceMade, validated } from '../../../gpu/core/errorScope.ts'
import { ledgerTentative } from '../../../gpu/core/deviceLedger.ts'
import { makeVsmMask } from '../render/vsm/vsmPlan.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { drawnViewChanged, type WebgpuView } from '../state/view.ts'
import { onView } from '../state/viewSwitch.ts'
import { makeTargets } from './targets.ts'
import { fundFrameTargets, poolFundingPending } from './targetFunding.ts'
import type { AskedTargets, HeldTargets } from './targetsSet.ts'

/* What the device is asked for one view's frame targets the held way (`targetGrant.ts`): made under
 * its out-of-memory check, or refused by name. */

/** A session lost or released: what it asked is never a refusal. */
export const stopped = (rt: WebgpuPagesRuntime) => rt.run.lost || rt.signal.aborted

/** The frame targets `asked` refused by name, and why. */
export const refuseTargets = (
  rt: WebgpuPagesRuntime,
  asked: AskedTargets,
  reason: string,
  error?: unknown,
) =>
  rt.diag.engineDiagnostic('frame-targets-refused', 'The device refused the frame targets', {
    kind: 'error',
    code: 'WEBGPU_FRAME_TARGETS_REFUSED',
    reason,
    ...asked,
    ...(error === undefined ? {} : { error: String(error) }),
  })

/** Admit and allocate this view's targets, its Hi-Z pyramid among them (#1483): a refusal
 *  releases the attempt, never the device. */
export async function grantTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  asked: HeldTargets,
  view: WebgpuView,
) {
  const { diag } = rt
  await poolFundingPending(rt) // One funding moves the pools at a time (#1362).
  await onView(rt, view, () => fundFrameTargets(rt, asked, asked.requestedBytes))
  // Made, and released when refused, on the view that asked; tentatively
  // (`GpuDeviceLedger.tentative`): targets past the budget's limit are refused without refusing
  // the session, and the scale steps down (`stepDownAfterRefusal`).
  const make = () =>
    ledgerTentative(device, () =>
      onView(rt, view, () => {
        const made = makeTargets(rt, device, asked, asked.requestedBytes)
        return { allocation: made.allocation, destroy: () => onView(rt, view, made.destroy) }
      }),
    )
  const made = await deviceMade(device, make)
  if (stopped(rt) || !made) {
    made?.destroy()
    if (!stopped(rt)) refuseTargets(rt, asked, 'gpu-out-of-memory')
    return false
  }
  // The shadows' mask is a frame target: made with them, in the room funded for it.
  onView(rt, view, () => makeVsmMask(rt, device))
  const { allocation } = made
  diag.traceDiagnostic(
    'targets-transition',
    'GPU targets allocated after transition',
    () => allocation,
  )
  diag.engineDiagnostic('frame-allocation', 'GPU targets allocated', allocation)
  onView(rt, view, () => drawnViewChanged(rt))
  return true
}

/** `view`'s own Hi-Z pyramid at its size, under the device's out-of-memory check: false when
 *  refused, as frame targets are (`stepDownAfterRefusal`). */
export async function grantHiz(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  asked: HeldTargets,
  view: WebgpuView,
) {
  const hiz = rt.vis.gpuHiz!,
    { renderWidth: width, renderHeight: height } = asked
  // A resize that throws is refused like one the device declines: the grant never stays settled.
  const size = () => ledgerTentative(device, () => hiz.resize(device, width, height)) || undefined
  const fits = await validated(device, size, 'out-of-memory').catch(() => undefined)
  if (!fits && !stopped(rt)) refuseTargets(rt, asked, 'gpu-out-of-memory')
  onView(rt, view, () => drawnViewChanged(rt))
  return !!fits
}
