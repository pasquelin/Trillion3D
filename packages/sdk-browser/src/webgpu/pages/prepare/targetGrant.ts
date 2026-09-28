import { deviceMade, grantPending, startGrant, validated } from '../../../gpu/core/errorScope.ts';
import { dropGpuHiz } from '../io/drops.ts';
import { throwIfStopped } from '../io/lost.ts';
import { backdropBytes } from '../../transparent/transmission.ts';
import {
  createWebgpuCoplanarLayerPipelines,
  createWebgpuVisibilityRasterPipelines,
} from '../../visibility/pipelines.ts';
import { frameTargetAllocation, makeTargets, releaseTargets, targetsFit } from './targets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { drawnViewChanged, viewGpu, type WebgpuView } from '../state/view.ts';
import { onView } from '../state/viewSwitch.ts';
import { frameSizeOf, sameFrameSize, type FrameSize } from '../state/renderScale.ts';

/** True while no frame can be drawn: its targets are asked of the device, or were refused at
 *  this size. The frame is then held (`holdWebgpuFrame`), and nothing is presented. */
export const frameTargetsAwaited = (rt: WebgpuPagesRuntime) => rt.gpu.targetGrant !== undefined;

/** A session lost or released: what it asked is never a refusal. */
const stopped = (rt: WebgpuPagesRuntime) => rt.run.lost || rt.signal.aborted;

type Asked = FrameSize & { requestedBytes: number };

/** The size asked this frame: copied only when a grant starts, never allocated per frame. */
const wanted = {} as FrameSize;

/** The frame targets `asked` refused by name, and why. */
const refuseTargets = (rt: WebgpuPagesRuntime, asked: Asked, reason: string, error?: unknown) =>
  rt.diag.engineDiagnostic('frame-targets-refused', 'The device refused the frame targets', {
    kind: 'error',
    code: 'WEBGPU_FRAME_TARGETS_REFUSED',
    reason,
    ...asked,
    ...(error === undefined ? {} : { error: String(error) }),
  });

/**
 * Asks the device for the frame targets of the view's sizes (`frameSizeOf`), unless those in place
 * fit, a grant is still in flight — one at a time —, or this size was refused. A size the device
 * cannot make is refused at once, by name (`SURFACE_DEVICE_LIMIT`), before anything is released.
 * The answer lands on the view that asked, whichever is drawn when it comes (`onView`).
 */
export function requestFrameTargets(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, capture, diag, run } = rt,
    size = frameSizeOf(rt, wanted),
    { width, height, renderWidth, renderHeight } = size;
  const fit = targetsFit(rt, size),
    hiz = rt.vis.gpuHiz;
  // The view's Hi-Z pyramid fits too, at the render size, or Hi-Z is absent.
  if (fit && (!hiz || (hiz.width === renderWidth && hiz.height === renderHeight))) return;
  const pending = gpu.targetGrant;
  if (pending && (!pending.settled || sameFrameSize(pending, size))) return pending.done;
  const view = rt.views.active,
    granted = () => void (viewGpu(rt, view).targetGrant = undefined);
  // The view's targets are in place, its pyramid is not: it alone is asked.
  if (fit) {
    const done = grantHiz(rt, device, renderWidth, renderHeight, view).then(granted);
    gpu.targetGrant = startGrant(done, { ...size });
    return gpu.targetGrant.done;
  }
  diag.traceDiagnostic('targets-request', 'GPU frame targets request', () => ({
    frame: run.frame,
    width,
    height,
    renderWidth,
    renderHeight,
    previousSize: gpu.targetSize.slice(),
    additionalBytes: capture.captureAllocationBytes,
    hiZReserved: rt.setup.reserveHiz,
  }));
  // Thrown here, synchronously: a size beyond the device's limits releases nothing.
  const extra = capture.captureAllocationBytes + backdropBytes(rt, renderWidth, renderHeight),
    asked = { ...size, requestedBytes: frameTargetAllocation(rt, size, extra) };
  // Granted, the record goes; refused, it stays, settled, and holds the frames at this size. A
  // creation that throws refuses them by name too, unless the session stopped.
  const done = grantTargets(rt, device, asked, view).then(
    (made) => void (made && granted()),
    (error: unknown) => {
      onView(rt, view, () => releaseTargets(rt));
      if (!stopped(rt)) refuseTargets(rt, asked, 'gpu-error', error);
    },
  );
  gpu.targetGrant = startGrant(done, { ...size });
  return gpu.targetGrant.done;
}

/**
 * The frame targets of the view's size, granted before a capture or prepare draws with
 * them: a grant in flight is waited for first, and a size refused before is asked again.
 * What the device refuses even without Hi-Z is refused by name: `WEBGPU_FRAME_TARGETS_REFUSED`.
 */
export async function grantFrameTargets(rt: WebgpuPagesRuntime, device: GPUDevice) {
  await grantPending(rt.gpu.targetGrant);
  rt.gpu.targetGrant = undefined;
  await requestFrameTargets(rt, device);
  if (!frameTargetsAwaited(rt)) return;
  // A session stopped meanwhile says so, rather than a refusal.
  throwIfStopped(rt);
  throw new Error('WEBGPU_FRAME_TARGETS_REFUSED');
}

/**
 * The targets made under the device's out-of-memory check (`deviceMade`), the set in place
 * released first so a resize never holds two. A refusal drops Hi-Z, whose absence changes no
 * image, and asks again; refused without it, they are refused by name, never as a lost device.
 * Resolves to whether the device granted them.
 */
async function grantTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  asked: Asked,
  view: WebgpuView,
) {
  const { vis, diag } = rt,
    hiz = !!vis.gpuHiz;
  // Made, and released when refused, on the view that asked.
  const make = () =>
    onView(rt, view, () => {
      const made = makeTargets(rt, device, asked, asked.requestedBytes);
      return { allocation: made.allocation, destroy: () => onView(rt, view, made.destroy) };
    });
  let made = await deviceMade(device, make);
  // A session stopped meanwhile asks nothing again, and keeps its Hi-Z.
  if (!made && !stopped(rt) && vis.gpuHiz) {
    hizRefused(rt, 'The device refused the frame targets', asked.requestedBytes);
    made = await deviceMade(device, make);
  }
  if (stopped(rt) || !made) {
    made?.destroy();
    if (!stopped(rt)) refuseTargets(rt, asked, 'gpu-out-of-memory');
    return false;
  }
  // Without Hi-Z the visibility pass writes one target fewer: its pipelines follow, frame held.
  if (hiz && !vis.gpuHiz && vis.visModule) await rasterWithoutHiz(rt, device, vis.visModule);
  const { allocation } = made;
  diag.traceDiagnostic(
    'targets-transition',
    'GPU targets allocated after transition',
    () => allocation,
  );
  diag.engineDiagnostic('frame-allocation', 'GPU targets allocated', allocation);
  onView(rt, view, () => drawnViewChanged(rt));
  return true;
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
    hiz = vis.gpuHiz!;
  // A resize that throws is refused like one the device declines: the grant never stays settled.
  const size = () => hiz.resize(device, width, height) || undefined;
  const fits = await validated(device, size, 'out-of-memory').catch(() => undefined);
  if (!fits && !stopped(rt) && vis.gpuHiz) {
    hizRefused(rt, 'The device refused the Hi-Z pyramid');
    if (vis.visModule) await rasterWithoutHiz(rt, device, vis.visModule);
  }
  onView(rt, view, () => drawnViewChanged(rt));
}

/** Hi-Z refused by the device leaves, said: its absence changes no image. */
function hizRefused(rt: WebgpuPagesRuntime, message: string, requestedBytes?: number) {
  rt.diag.engineDiagnostic('gpu-out-of-memory', message, {
    kind: 'warning',
    pool: 'frame-targets',
    requestedBytes,
    dropped: 'hi-z',
  });
  dropGpuHiz(rt);
}

/** The visibility raster pipelines, those of the coplanar layers included, made without Hi-Z. */
async function rasterWithoutHiz(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  module: GPUShaderModule,
) {
  const { vis } = rt,
    layout = vis.visBindGroupLayout!,
    variant = rt.context?.diagnosticGpuVariant;
  Object.assign(
    vis,
    await createWebgpuVisibilityRasterPipelines(device, module, layout, false, variant),
  );
  if (vis.drawLayerSlots > 1)
    vis.visLayerPipelines = await createWebgpuCoplanarLayerPipelines(
      device,
      module,
      layout,
      false,
      vis.drawLayerSlots,
      variant,
    );
}
