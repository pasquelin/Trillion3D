import { grantPending, startGrant } from '../../../gpu/core/errorScope.ts'
import { throwIfStopped } from '../io/lost.ts'
import { releaseTargets, targetsFit } from './targets.ts'
import { frameExtraBytes, frameTargetAllocation } from './targetAllocation.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { viewGpu, type WebgpuView } from '../state/view.ts'
import { heldTargetGrant } from '../state/gpu.ts'
import { onView } from '../state/viewSwitch.ts'
import {
  frameSizeOf,
  sameFrameSize,
  scalesTargets,
  viewKey,
  type FrameSize,
} from '../state/renderScale.ts'
import { refreshTargetGrant } from './targetFunding.ts'
import { grantHiz, grantTargets, refuseTargets, stopped } from './targetDevice.ts'
import { asideTargets, asksAside, makeTargetsAside } from './targetsAside.ts'
import { dropAside, type HeldTargets } from './targetsSet.ts'

/** True while no frame can be drawn: its targets are asked of the device the held way, or were
 *  refused at this size. The frame is then held (`holdWebgpuFrame`), and nothing is presented. */
export const frameTargetsAwaited = (rt: WebgpuPagesRuntime) => heldTargetGrant(rt.gpu) !== undefined

/** The size asked this frame: copied only when a grant starts, never allocated per frame. */
const wanted = {} as FrameSize

/** A refusal for memory: the device's, or the budget's limit (`GPU_BUDGET_EXCEEDED`). */
const memoryRefusal = (error?: unknown) =>
  error === undefined || /GPU_BUDGET_(EXCEEDED|UNDER_MINIMUM)/.test(String(error))

/**
 * Targets refused for memory at a size the controller scales (`scalesTargets`): the render scale
 * is held one eighth below the targets' at this view size (`ScaleControl.capMemory`), said, and
 * the grant forgotten so the next frame asks that smaller size — the frame always draws, at the
 * resolution the budget holds. The cap is lifted again after a wait that doubles at each refusal
 * (`ScaleControl.memoryRefused`, `liftMemoryCap`): the resolution comes back once the budget holds
 * it. At the scale's floor, or for a scale the page fixed, the refused size is asked again after
 * it, at the grant's `retryAt`.
 */
function stepDownAfterRefusal(
  rt: WebgpuPagesRuntime,
  asked: HeldTargets,
  view: WebgpuView,
  error?: unknown,
) {
  const at = rt.scale.memoryRefused(viewKey(rt), rt.run.frame)
  if (!memoryRefusal(error) || !scalesTargets(rt) || !rt.scale.capMemory(viewKey(rt))) {
    asked.retryAt = at
    return
  }
  // `asked` is the grant record (`startGrant`): forgotten on the view that asked it.
  const gpu = viewGpu(rt, view)
  if ((gpu.targetGrant as object | undefined) === asked) gpu.targetGrant = undefined
  rt.diag.engineDiagnostic(
    'render-scale-capped',
    'The GPU budget holds the frame at a lower scale',
    {
      kind: 'warning',
      refusedWidth: asked.renderWidth,
      refusedHeight: asked.renderHeight,
      requestedBytes: asked.requestedBytes,
    },
  )
}

/**
 * Asks the device for the frame targets of the view's sizes (`frameSizeOf`), unless those in place
 * fit, a grant is still in flight — one at a time —, or this size was refused. A size the device
 * cannot make is refused at once, by name (`SURFACE_DEVICE_LIMIT`), before anything is released.
 * The answer lands on the view that asked, whichever is drawn when it comes (`onView`). At the
 * display's size in place, the targets are made beside those, which the frames draw into meanwhile
 * (`targetsAside.ts`); refused there, or `held`, they are asked the held way: those in place
 * released, the frames held until the device answers.
 */
export function requestFrameTargets(rt: WebgpuPagesRuntime, device: GPUDevice, held = false) {
  const { gpu, capture, diag, run } = rt
  rt.scale.liftMemoryCap(run.frame)
  const size = frameSizeOf(rt, wanted),
    { width, height, renderWidth, renderHeight } = size
  const fit = targetsFit(rt, size),
    hiz = rt.vis.gpuHiz,
    aside = asideTargets(rt)
  // Targets made aside are swapped in at a frame's entry (`swapAsideTargets`); they go once those
  // in place fit or the display moved, and refused, the held way is taken.
  if (aside && !aside.settled) return aside.done
  if (aside?.granted && !fit && aside.width === width && aside.height === height) return
  if (aside) {
    held ||= !aside.granted
    dropAside(rt)
  }
  // The view's Hi-Z pyramid fits too, at the render size.
  if (fit && (!hiz || (hiz.width === renderWidth && hiz.height === renderHeight))) {
    return refreshTargetGrant(rt, size, (error) =>
      refuseTargets(rt, { ...size, requestedBytes: gpu.targetBytes }, 'budget', error),
    )
  }
  // Made aside, the grant went above: one asked the held way is left, if any.
  const pending = heldTargetGrant(gpu)
  // A size refused is asked again after its wait (`memoryRefused`): never every frame, never never.
  if (
    pending &&
    (!pending.settled ||
      (sameFrameSize(pending, size) && run.frame < (pending.retryAt ?? Infinity)))
  )
    return pending.done
  const view = rt.views.active,
    granted = () => void (viewGpu(rt, view).targetGrant = undefined)
  // The view's targets are in place, its pyramid is not: it alone is asked, refused as they are.
  if (fit) {
    const asked: HeldTargets = { ...size, mode: 'held', requestedBytes: gpu.targetBytes }
    const done = grantHiz(rt, device, asked, view).then(
      (made) => void (made ? granted() : !stopped(rt) && stepDownAfterRefusal(rt, asked, view)),
    )
    gpu.targetGrant = startGrant(done, asked)
    return gpu.targetGrant.done
  }
  diag.traceDiagnostic('targets-request', 'GPU frame targets request', () => ({
    frame: run.frame,
    width,
    height,
    renderWidth,
    renderHeight,
    previousSize: gpu.targetSize.slice(),
    additionalBytes: capture.captureAllocationBytes,
    // The view's pyramid, which the targets' bytes count while it exists (`frameTargetAllocation`).
    hiZReserved: !!hiz,
  }))
  // Thrown here, synchronously: a size beyond the device's limits releases nothing.
  const extra = frameExtraBytes(rt, size),
    requestedBytes = frameTargetAllocation(rt, size, extra),
    asked: HeldTargets = { ...size, mode: 'held', requestedBytes }
  if (!held && asksAside(rt, asked)) return makeTargetsAside(rt, device, asked)
  // Granted, the record goes; refused, it stays, settled, and holds the frames at this size. A
  // creation that throws refuses them by name too, unless the session stopped.
  const done = grantTargets(rt, device, asked, view).then(
    (made) => void (made ? granted() : !stopped(rt) && stepDownAfterRefusal(rt, asked, view)),
    (error: unknown) => {
      // Refused by the budget's split, before any target was touched: those in place are kept.
      if (!/GPU_BUDGET_UNDER_MINIMUM/.test(String(error)))
        onView(rt, view, () => releaseTargets(rt))
      if (stopped(rt)) return
      refuseTargets(rt, asked, 'gpu-error', error)
      stepDownAfterRefusal(rt, asked, view, error)
    },
  )
  gpu.targetGrant = startGrant(done, asked)
  return gpu.targetGrant.done
}

/** Await or retry the current target grant before preparation or capture. */
export async function grantFrameTargets(rt: WebgpuPagesRuntime, device: GPUDevice) {
  // Awaited, never swapped later: targets made aside meanwhile go.
  await grantPending(rt.gpu.targetGrant)
  dropAside(rt)
  rt.gpu.targetGrant = undefined
  await requestFrameTargets(rt, device, true)
  if (!frameTargetsAwaited(rt)) return
  // A session stopped meanwhile says so, rather than a refusal.
  throwIfStopped(rt)
  throw new Error('WEBGPU_FRAME_TARGETS_REFUSED')
}
