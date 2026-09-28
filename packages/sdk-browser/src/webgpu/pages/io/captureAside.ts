import { copyDrawnFromShown } from '../helpers.ts';
import type { HostCamera } from '../../../camera/world.ts';
import { encodeDraws } from '../render/encodeDraws.ts';
import { renderWebgpuPages } from '../render/render.ts';
import { grantFrameTargets } from '../prepare/targetGrant.ts';
import { sizeShadowPool } from '../../shadow/poolSize.ts';
import { deviceAnswer } from '../../frame/deviceAnswer.ts';
import { createWebgpuView } from '../state/view.ts';
import { releaseWebgpuView, useWebgpuView } from '../state/viewSwitch.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

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
  const { capture } = rt;
  // A light that casts asks its shadow pool of the device before anything is drawn: the capture
  // waits for the answer, never drawn without its shadows (#483). The pool is sized from the
  // canvas, before the capture's own view is drawn.
  sizeShadowPool(rt);
  capture.capturing = true;
  const view = createWebgpuView(size.width, size.height);
  try {
    await deviceAnswer(rt);
    await rt.services.residency.pending;
    await rt.gpu.device?.queue.onSubmittedWorkDone();
    // A session closed meanwhile draws nothing.
    rt.context.signal?.throwIfAborted();
    useWebgpuView(rt, view);
    return await work();
  } finally {
    releaseWebgpuView(rt, view);
    capture.capturing = false;
    capture.surfaceRenderAllowed = false;
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
  await grantFrameTargets(rt, rt.gpu.device!);
  rt.capture.surfaceRenderAllowed = true;
  try {
    renderWebgpuPages(rt, camera, aspect);
  } finally {
    rt.capture.surfaceRenderAllowed = false;
  }
}

/**
 * Waits until every page of the displayed cut is resident, then draws it for the current image's
 * view. No camera enters here: `renderForCapture` has just entered its own through the contract, and
 * encode reads only the engine camera. The hooks let a capture refuse a cut the budget or the host
 * has dropped, before any send and any draw.
 */
export async function drawResidentCut(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  hooks: { admitted?: () => void; beforeEncode?: () => void } = {},
) {
  const { run, services } = rt;
  await services.residency.pending;
  hooks.admitted?.();
  await services.ensureResident(run.shown, run.frame, services.residency.nextJobId());
  if (!run.shown.every(services.poolHolds)) throw new Error('SURFACE_GPU_COVERAGE_INCOMPLETE');
  copyDrawnFromShown(run);
  hooks.beforeEncode?.();
  run.submittedTriangles = encodeDraws(rt, gpuDevice, run.gate.cam);
}
