import { deviceMade, startGrant } from '../../../gpu/core/errorScope.ts';
import { ledgerRoom, ledgerTentative } from '../../../gpu/core/deviceLedger.ts';
import { invalidateOccluderHistory } from '../io/drops.ts';
import { restartTaaOnLanding } from '../../../taa/landing.ts';
import { makeVsmMask } from '../render/vsm/vsmPlan.ts';
import { onView } from '../state/viewSwitch.ts';
import type { FrameSize } from '../state/renderScale.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { buildTargets, targetAllocationOf } from './targets.ts';
import { syncFeedbackTarget } from './feedbackVariant.ts';
import {
  asides,
  destroyAside,
  emptySet,
  releaseSet,
  tradeSet,
  type Aside,
  type AsideTargets,
  type TargetSet,
} from './targetsSet.ts';

/*
 * Targets of another render size or other members at the display's size in place are made BESIDE
 * those in place (#831): the frames go on drawing in the old ones — no frame held for the device's
 * answer, no history restarted — and the next frame's entry swaps them in (`swapAsideTargets`),
 * the old ones freed then. Both live at once, which the device's ledger counts: a set that does not
 * fit beside the one in place is refused, and the targets are asked the held way
 * (`requestFrameTargets`). The way `setWebgpuMemoryBudgets` rebuilds the pools while the old live.
 */

/** The drawn view's targets made aside, while it has some. */
export const asideTargets = (rt: WebgpuPagesRuntime) => {
  const aside = asides.get(rt);
  return aside && aside.view === rt.views.active ? aside : undefined;
};

/** Whether targets made aside are still asked of the device, or granted and not yet swapped in: a
 *  frame held meanwhile is not the still one the page waits for, since the swap draws the next. */
export const asidePending = (rt: WebgpuPagesRuntime) => {
  const aside = asides.get(rt);
  return !!aside && (!aside.settled || aside.granted);
};

/** Whether the targets `asked`, `asked.requestedBytes` of them, are asked aside: the main view's
 *  targets in place at the same display size, which the visibility pass goes on drawing into — the
 *  fallback draw cannot, below the display (#816) —, nothing asked of them otherwise, the room for
 *  both. */
export function asksAside(rt: WebgpuPagesRuntime, asked: FrameSize & { requestedBytes: number }) {
  const { gpu, vis, views, capture } = rt;
  return (
    views.active === views.main &&
    !capture.capturing &&
    vis.visEnabled &&
    !!vis.visView &&
    !asides.has(rt) &&
    gpu.targetGrant === undefined &&
    !!gpu.hdrTexture &&
    gpu.displaySize[0] === asked.width &&
    gpu.displaySize[1] === asked.height &&
    asked.requestedBytes <= ledgerRoom(gpu.device)
  );
}

/** Asks the device for the targets `asked` beside those in place; their answer is read at the next
 *  frame's entry (`swapAsideTargets`), or by `requestFrameTargets` when refused. */
export function makeTargetsAside(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  asked: FrameSize & { requestedBytes: number },
) {
  const aside: AsideTargets = { ...asked, view: rt.views.active, granted: false, dropped: false };
  const make = () =>
    ledgerTentative(device, () => onView(rt, aside.view, () => buildAside(rt, device, aside)));
  const done = deviceMade(device, make).then(
    (made) => void (aside.granted = !!made && !aside.dropped),
    () => destroyAside(aside),
  );
  const grant: Aside = startGrant(done, aside);
  asides.set(rt, grant);
  return grant.done;
}

/** Makes `aside`'s targets in the runtime's groups, those in place held apart meanwhile and put
 *  back: synchronous, no frame sees the groups between. A new render size has its own Hi-Z pyramid,
 *  made the same way. Refused — a creation that throws, a pyramid not made —, what was made goes. */
function buildAside(rt: WebgpuPagesRuntime, device: GPUDevice, aside: AsideTargets) {
  const held = emptySet(),
    made = emptySet(),
    hiz = resizes(rt, aside) ? rt.vis.gpuHiz : undefined;
  aside.set = made;
  tradeSet(rt, held, made);
  const pyramid = hiz?.swap(undefined);
  try {
    buildTargets(rt, device, aside, aside.requestedBytes);
    if (hiz && !hiz.resize(device, aside.renderWidth, aside.renderHeight))
      throw new Error('WEBGPU_HIZ_REFUSED');
  } finally {
    tradeSet(rt, made, held);
    if (hiz) aside.hiz = hiz.swap(pyramid);
  }
  return { destroy: () => destroyAside(aside) };
}

/** Whether `aside` is of another render size than the targets in place. */
const resizes = (rt: WebgpuPagesRuntime, aside: FrameSize) =>
  rt.gpu.allocatedSize[0] !== aside.renderWidth || rt.gpu.allocatedSize[1] !== aside.renderHeight;

/**
 * At a frame's entry, before anything is drawn: the targets the device granted aside replace those
 * in place, which are freed — the frames before drew into them. The temporal history, the
 * display's, stays; a new render size restarts a still average, as a landing does, and the
 * occlusion history, whose pyramid is another. Returns whether they did: this frame is then drawn,
 * never held on a display colour the new targets never had (`holdWebgpuFrame`).
 */
export function swapAsideTargets(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const aside = asideTargets(rt);
  if (!aside?.granted || !aside.set) return false;
  asides.delete(rt);
  const { vis, run } = rt,
    resized = resizes(rt, aside),
    old: TargetSet = emptySet();
  tradeSet(rt, old, aside.set);
  // Made for the pipelines in place when they were asked: a feedback variant installed since makes
  // or releases their feedback target (`followFeedback` runs before this entry swaps them in).
  syncFeedbackTarget(rt, device);
  // Hi-Z dropped meanwhile: the pyramid made for it goes too.
  if (aside.hiz) (vis.gpuHiz ? vis.gpuHiz.swap(aside.hiz) : aside.hiz)?.destroy();
  releaseSet(old.gpu, old.vis);
  rt.capture.capturedPixels = undefined;
  rt.capture.capturedRevision = -1;
  // The shadows' mask is a frame target: made with them, as a grant makes it.
  makeVsmMask(rt, device);
  if (resized) {
    invalidateOccluderHistory(run);
    restartTaaOnLanding(rt, 1);
  }
  rt.diag.engineDiagnostic('frame-allocation', 'GPU targets allocated', targetAllocationOf(rt));
  return true;
}
