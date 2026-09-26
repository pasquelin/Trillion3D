import { deviceMade, grantPending, startGrant } from '../../../gpu/core/errorScope.ts';
import { dropGpuHiz } from '../io/drops.ts';
import { throwIfStopped } from '../io/lost.ts';
import { backdropBytes } from '../../transparent/transmission.ts';
import {
  createWebgpuCoplanarLayerPipelines,
  createWebgpuVisibilityRasterPipelines,
} from '../../visibility/pipelines.ts';
import { frameTargetAllocation, makeTargets, releaseTargets, targetsFit } from './targets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** True while no frame can be drawn: its targets are asked of the device, or were refused at
 *  this size. The frame is then held (`holdWebgpuFrame`), and nothing is presented. */
export const frameTargetsAwaited = (rt: WebgpuPagesRuntime) => rt.gpu.targetGrant !== undefined;

/** A session lost or released: what it asked is never a refusal. */
const stopped = (rt: WebgpuPagesRuntime) => rt.run.lost || rt.signal.aborted;

type Asked = { width: number; height: number; requestedBytes: number };

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
 * Asks the device for the frame targets of the view's size, unless those in place fit, a grant
 * is still in flight — one at a time —, or this size was refused. A size the device cannot make
 * is refused at once, by name (`SURFACE_DEVICE_LIMIT`), before anything is released.
 */
export function requestFrameTargets(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, capture, diag, run } = rt,
    width = Math.max(1, rt.setup.viewport[0]),
    height = Math.max(1, rt.setup.viewport[1]);
  if (targetsFit(rt, width, height)) return;
  const pending = gpu.targetGrant;
  if (pending && (!pending.settled || (pending.width === width && pending.height === height)))
    return pending.done;
  diag.traceDiagnostic('targets-request', 'GPU frame targets request', () => ({
    frame: run.frame,
    width,
    height,
    previousSize: gpu.targetSize.slice(),
    additionalBytes: capture.captureAllocationBytes,
    hiZReserved: rt.setup.reserveHiz,
  }));
  // Thrown here, synchronously: a size beyond the device's limits releases nothing.
  const extra = capture.captureAllocationBytes + backdropBytes(rt, width, height),
    asked = { width, height, requestedBytes: frameTargetAllocation(rt, width, height, extra) };
  // Granted, the record goes; refused, it stays, settled, and holds the frames at this size. A
  // creation that throws refuses them by name too, unless the session stopped.
  const done = grantTargets(rt, device, asked).then(
    (granted) => {
      if (granted) gpu.targetGrant = undefined;
    },
    (error: unknown) => {
      releaseTargets(rt);
      if (!stopped(rt)) refuseTargets(rt, asked, 'gpu-error', error);
    },
  );
  gpu.targetGrant = startGrant(done, { width, height });
  return gpu.targetGrant.done;
}

/**
 * The frame targets of the view's size, granted before a capture, its restore or prepare draws
 * with them: a grant in flight is waited for first, and a size refused before is asked again.
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
async function grantTargets(rt: WebgpuPagesRuntime, device: GPUDevice, asked: Asked) {
  const { vis, diag, run } = rt,
    hiz = !!vis.gpuHiz;
  const make = () => makeTargets(rt, device, asked.width, asked.height, asked.requestedBytes);
  let made = await deviceMade(device, make);
  // A session stopped meanwhile asks nothing again, and keeps its Hi-Z.
  if (!made && !stopped(rt) && vis.gpuHiz) {
    diag.engineDiagnostic('gpu-out-of-memory', 'The device refused the frame targets', {
      kind: 'warning',
      pool: 'frame-targets',
      requestedBytes: asked.requestedBytes,
      dropped: 'hi-z',
    });
    dropGpuHiz(rt);
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
  run.gate.resourcesChanged();
  return true;
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
