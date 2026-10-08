import type { HostCamera } from '../../../camera/world.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { grantFrameTargets } from '../prepare/targetGrant.ts'
import { poolFundingPending } from '../prepare/targetFunding.ts'
import { deviceAnswer } from '../../frame/deviceAnswer.ts'
import { grantPending } from '../../../gpu/core/errorScope.ts'
import { createWebgpuView, type WebgpuView } from '../state/view.ts'
import { releaseWebgpuView, useWebgpuView } from '../state/viewSwitch.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** Targets asked of the device, or pools funded again beside them, while a capture draws:
 *  it waits for them and draws again, never reading pages a funding moved. */
const targetsMoving = (rt: WebgpuPagesRuntime) =>
  rt.gpu.targetGrant !== undefined || poolFundingPending(rt) !== undefined

/**
 * Runs `work` in a view of its own at `width × height`, once the device has answered for what the
 * scene asked and the residency and the queue are settled. The capture renders there, into
 * targets of its own: the main view keeps its targets, its cut and its temporal and occlusion
 * history, and the canvas keeps showing it. The view is released after, whatever `work` did.
 */
export async function captureAside<T>(
  rt: WebgpuPagesRuntime,
  size: { width: number; height: number },
  work: () => Promise<T>,
) {
  const { capture } = rt
  // The capture asks no shadow memory of its own: the frames make the virtual shadow maps they
  // draw (`../render/vsm/vsmEncode.ts`), and the capture waits for them to settle
  // (`shadowsUnsettled`).
  capture.capturing = true
  const view = createWebgpuView(size.width, size.height)
  let drawn = false
  try {
    await deviceAnswer(rt)
    await rt.services.residency.pending
    await rt.gpu.device?.queue.onSubmittedWorkDone()
    // The main view's grant in flight settles before the switch, on the main view.
    await grantPending(rt.gpu.targetGrant)
    await poolFundingPending(rt)
    // A session closed meanwhile draws nothing.
    rt.context.signal?.throwIfAborted()
    useWebgpuView(rt, view)
    drawn = true
    return await work()
  } finally {
    // Drawn, the view is released, even after a dispose switched back; never drawn, it made nothing.
    try {
      if (drawn) await releaseSettledCapture(rt, view)
    } finally {
      capture.capturing = false
    }
  }
}

/** Renders through the backend while a capture holds it, which `render` otherwise refuses, into
 *  targets granted first (`grantFrameTargets`). `aspect` is the shape of the surface written
 *  into, when it is not the camera's own. */
export async function renderForCapture(
  rt: WebgpuPagesRuntime,
  camera: HostCamera,
  aspect?: number,
) {
  await grantFrameTargets(rt, rt.gpu.device!)
  rt.capture.surfaceRenderAllowed = true
  try {
    renderWebgpuPages(rt, camera, aspect)
    // Selection can reveal a first mirror after the initial target grant. Finish that grant
    // and draw its targets before any capture reads them or returns to the original view.
    if (targetsMoving(rt)) {
      await grantFrameTargets(rt, rt.gpu.device!)
      renderWebgpuPages(rt, camera, aspect)
      if (targetsMoving(rt)) throw new Error('CAPTURE_TARGETS_CHANGED_DURING_RENDER')
    }
  } finally {
    rt.capture.surfaceRenderAllowed = false
  }
}

/** Rounds a capture waits through at most before it says its cut never settled: a round reads
 *  the cut back and asks for its pages and rows, a growing table or a time budget adds rounds. */
const CAPTURE_ROUNDS = 64

/**
 * Whether the capture's cut is whole: every page of it the pool accepted is resident, its instance
 * ready for the GPU cut — bytes and row (`../../row/slots.ts`) —, and no row is owed. A page past
 * the budget is drawn by its nearest resident ancestor, as on any image.
 */
function captureSettled(rt: WebgpuPagesRuntime) {
  const { run, services, views } = rt,
    { rows } = rt.layout
  if (!views.active.cut?.adopted || !services.bootstrapState.ready) return false
  if (services.rowsOwed() || rows.rowsDenied) return false
  for (let i = 0; i < run.desired.length; i++) {
    const rec = run.desired[i]
    if (!services.residencySets.accepts(rec)) continue
    if (!services.poolHolds(rec) || !rows.residentFlags[run.desiredPacked[i]]) return false
  }
  return true
}

/**
 * Draws the capture's cut once it is whole. Each round reads back the cut the last image of the
 * view drew (`../../../gpu/dag/aside.ts`), adopts it — its requests join the queue, ranked first
 * under the one budget (#268) —, waits for the queue, and draws again: the GPU cut then draws the
 * pages that landed and the rows they took. The hooks let a capture refuse a cut the budget or the
 * host has dropped, before any draw.
 */
export async function drawResidentCut(
  rt: WebgpuPagesRuntime,
  camera: HostCamera,
  aspect: number,
  hooks: { admitted?: () => void; beforeEncode?: () => void } = {},
) {
  const { run, services } = rt
  for (let round = 0; ; round++) {
    await run.asideCut?.flush()
    services.adoptViewCut()
    services.queueCutResidency()
    await services.residency.pending
    await rt.layout.growing
    hooks.admitted?.()
    const settled = captureSettled(rt)
    if (!settled && round + 1 >= CAPTURE_ROUNDS) throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE')
    hooks.beforeEncode?.()
    await renderForCapture(rt, camera, aspect)
    if (settled) return
  }
}

/** A rejected retry may still own a target grant. Its completion must run on the capture
 * view, never against the restored main view's mutable GPU state. Cleanup holds on rejection. */
export async function releaseSettledCapture(rt: WebgpuPagesRuntime, view: WebgpuView) {
  try {
    await grantPending(rt.views.active === view ? rt.gpu.targetGrant : view.gpu.targetGrant)
    await poolFundingPending(rt)
  } finally {
    releaseWebgpuView(rt, view)
  }
}
