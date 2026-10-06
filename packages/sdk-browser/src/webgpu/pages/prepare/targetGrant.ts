import { deviceMade, grantPending, startGrant, validated } from '../../../gpu/core/errorScope.ts'
import { ledgerTentative } from '../../../gpu/core/deviceLedger.ts'
import { dropGpuHiz } from '../io/drops.ts'
import { throwIfStopped } from '../io/lost.ts'
import {
  createWebgpuCoplanarLayerPipelines,
  createWebgpuVisibilityRasterPipelines,
} from '../../visibility/pipelines.ts'
import { makeTargets, releaseTargets, targetsFit } from './targets.ts'
import { makeVsmMask } from '../render/vsm/vsmPlan.ts'
import { frameExtraBytes, frameTargetAllocation } from './targetAllocation.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { drawnViewChanged, viewGpu, type WebgpuView } from '../state/view.ts'
import { onView } from '../state/viewSwitch.ts'
import {
  frameSizeOf,
  sameFrameSize,
  scalesTargets,
  viewKey,
  type FrameSize,
} from '../state/renderScale.ts'
import { fundFrameTargets, poolFundingPending, refreshTargetGrant } from './targetFunding.ts'
import { asideTargets, asksAside, makeTargetsAside } from './targetsAside.ts'
import { dropAside } from './targetsSet.ts'

/** True while no frame can be drawn: its targets are asked of the device, or were refused at
 *  this size. The frame is then held (`holdWebgpuFrame`), and nothing is presented. */
export const frameTargetsAwaited = (rt: WebgpuPagesRuntime) => rt.gpu.targetGrant !== undefined

/** A session lost or released: what it asked is never a refusal. */
const stopped = (rt: WebgpuPagesRuntime) => rt.run.lost || rt.signal.aborted

type Asked = FrameSize & { requestedBytes: number; retryAt?: number }
/** The size asked this frame: copied only when a grant starts, never allocated per frame. */
const wanted = {} as FrameSize
/** The frame targets `asked` refused by name, and why. */
const refuseTargets = (rt: WebgpuPagesRuntime, asked: Asked, reason: string, error?: unknown) =>
  rt.diag.engineDiagnostic('frame-targets-refused', 'The device refused the frame targets', {
    kind: 'error',
    code: 'WEBGPU_FRAME_TARGETS_REFUSED',
    reason,
    ...asked,
    ...(error === undefined ? {} : { error: String(error) }),
  })

/** A refusal for memory: the device's, or the budget's limit (`GPU_BUDGET_EXCEEDED`). */
const memoryRefusal = (error?: unknown) =>
  error === undefined || /GPU_BUDGET_(EXCEEDED|UNDER_MINIMUM)/.test(String(error))

/** Frames a refused size waits before it is asked again, then twice as many after each refusal,
 *  up to `RETRY_MAX` times that: a budget whose room no measure predicts — the pools are budgets of
 *  their own, moved by each funding — is asked again rarely, never every frame, never never. */
const RETRY_FRAMES = 300,
  RETRY_MAX = 64
/** The next frame a refused size may be asked again at, and the wait after the next refusal. */
const retries = new WeakMap<WebgpuPagesRuntime, { view: string; at: number; wait: number }>()

/** The frame a size refused now may be asked again at: later after each refusal at this view. */
function retryAfterRefusal(rt: WebgpuPagesRuntime) {
  const view = viewKey(rt),
    held = retries.get(rt),
    wait = held?.view === view ? Math.min(held.wait * 2, RETRY_FRAMES * RETRY_MAX) : RETRY_FRAMES
  const at = rt.run.frame + wait
  retries.set(rt, { view, at, wait })
  return at
}

/**
 * Targets refused for memory at a size the controller scales (`scalesTargets`): the render scale
 * is held one eighth below the targets' at this view size (`ScaleControl.capMemory`), said, and
 * the grant forgotten so the next frame asks that smaller size — the frame always draws, at the
 * resolution the budget holds. The cap is lifted again after a wait that doubles at each refusal
 * (`retryAfterRefusal`, `liftMemoryCap`): the resolution comes back once the budget holds it. At
 * the scale's floor, or for a scale the page fixed, the refused size is asked again after it.
 */
function stepDownAfterRefusal(
  rt: WebgpuPagesRuntime,
  asked: Asked,
  view: WebgpuView,
  error?: unknown,
) {
  const at = retryAfterRefusal(rt)
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

/** The wait after the last refusal is over: the cap lifts, the targets are asked at the
 *  controller's scale again. */
function liftMemoryCap(rt: WebgpuPagesRuntime) {
  if (!rt.scale.memoryCapped) return
  const held = retries.get(rt)
  if (!held || rt.run.frame < held.at) return
  rt.scale.uncapMemory()
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
  liftMemoryCap(rt)
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
  // The view's Hi-Z pyramid fits too, at the render size, or Hi-Z is absent.
  if (fit && (!hiz || (hiz.width === renderWidth && hiz.height === renderHeight))) {
    return refreshTargetGrant(rt, size, (error) =>
      refuseTargets(rt, { ...size, requestedBytes: gpu.targetBytes }, 'budget', error),
    )
  }
  const pending = gpu.targetGrant
  // A size refused is asked again after its wait (`retryAfterRefusal`): never every frame, never
  // never.
  if (
    pending &&
    (!pending.settled ||
      (sameFrameSize(pending, size) && run.frame < (pending.retryAt ?? Infinity)))
  )
    return pending.done
  const view = rt.views.active,
    granted = () => void (viewGpu(rt, view).targetGrant = undefined)
  // The view's targets are in place, its pyramid is not: it alone is asked.
  if (fit) {
    const done = grantHiz(rt, device, renderWidth, renderHeight, view).then(granted)
    gpu.targetGrant = startGrant(done, { ...size })
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
    asked = { ...size, requestedBytes: frameTargetAllocation(rt, size, extra) }
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
  await grantPending(rt.gpu.targetGrant)
  rt.gpu.targetGrant = undefined
  // Awaited, never swapped later: targets made aside meanwhile go.
  await grantPending(asideTargets(rt))
  dropAside(rt)
  await requestFrameTargets(rt, device, true)
  if (!frameTargetsAwaited(rt)) return
  // A session stopped meanwhile says so, rather than a refusal.
  throwIfStopped(rt)
  throw new Error('WEBGPU_FRAME_TARGETS_REFUSED')
}

/** Admit and allocate this view's targets. Device refusal releases the attempt; a Hi-Z
 * refusal retries through the existing fallback, never by losing the device. */
async function grantTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  asked: Asked,
  view: WebgpuView,
) {
  const { vis, diag } = rt,
    hiz = !!vis.gpuHiz
  await poolFundingPending(rt) // One funding moves the pools at a time.
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
  let made = await deviceMade(device, make)
  // A session stopped meanwhile asks nothing again, and keeps its Hi-Z.
  if (!made && !stopped(rt) && vis.gpuHiz) {
    hizRefused(rt, 'The device refused the frame targets', asked.requestedBytes)
    // Without the pyramid, the targets hold its bytes no more.
    asked.requestedBytes = frameTargetAllocation(rt, asked, frameExtraBytes(rt, asked))
    made = await deviceMade(device, make)
  }
  if (stopped(rt) || !made) {
    made?.destroy()
    if (!stopped(rt)) refuseTargets(rt, asked, 'gpu-out-of-memory')
    return false
  }
  // The shadows' mask is a frame target: made with them, in the room funded for it.
  onView(rt, view, () => makeVsmMask(rt, device))
  // Without Hi-Z the visibility pass writes one target fewer: its pipelines follow, frame held.
  if (hiz && !vis.gpuHiz && vis.visModule) await rasterWithoutHiz(rt, device, vis.visModule)
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

/** `view`'s own Hi-Z pyramid at its size, under the device's out-of-memory check; refused, Hi-Z
 *  leaves — its absence changes no image — and the raster pipelines follow. */
async function grantHiz(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
  view: WebgpuView,
) {
  const { vis } = rt,
    hiz = vis.gpuHiz!
  // A resize that throws is refused like one the device declines: the grant never stays settled.
  const size = () => ledgerTentative(device, () => hiz.resize(device, width, height)) || undefined
  const fits = await validated(device, size, 'out-of-memory').catch(() => undefined)
  if (!fits && !stopped(rt) && vis.gpuHiz) {
    hizRefused(rt, 'The device refused the Hi-Z pyramid')
    if (vis.visModule) await rasterWithoutHiz(rt, device, vis.visModule)
  }
  onView(rt, view, () => drawnViewChanged(rt))
}

/** Hi-Z refused by the device leaves, said: its absence changes no image. */
function hizRefused(rt: WebgpuPagesRuntime, message: string, requestedBytes?: number) {
  rt.diag.engineDiagnostic('gpu-out-of-memory', message, {
    kind: 'warning',
    pool: 'frame-targets',
    requestedBytes,
    dropped: 'hi-z',
  })
  dropGpuHiz(rt)
}

/** The visibility raster pipelines, those of the coplanar layers included, made without Hi-Z. */
async function rasterWithoutHiz(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  module: GPUShaderModule,
) {
  const { vis } = rt,
    layout = vis.visBindGroupLayout!,
    variant = rt.context?.diagnosticGpuVariant
  Object.assign(
    vis,
    await createWebgpuVisibilityRasterPipelines(device, module, layout, false, variant),
  )
  if (vis.drawLayerSlots > 1)
    vis.visLayerPipelines = await createWebgpuCoplanarLayerPipelines(
      device,
      module,
      layout,
      false,
      vis.drawLayerSlots,
      variant,
    )
}
