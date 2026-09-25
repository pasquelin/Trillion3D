import { deviceMade, grantPending, startGrant } from '../../../gpu/core/errorScope.ts';
import { dropGpuHiz } from '../io/drops.ts';
import { throwIfStopped } from '../io/lost.ts';
import { backdropBytes } from '../../transparent/transmission.ts';
import { frameTargetAllocation, makeTargets, releaseTargets, targetsFit } from './targets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** True while no frame can be drawn: its targets are asked of the device, or were refused at
 *  this size. The frame is then held (`holdWebgpuFrame`), and nothing is presented. */
export const frameTargetsAwaited = (rt: WebgpuPagesRuntime) => rt.gpu.targetGrant !== undefined;

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
  const asked = gpu.targetGrant;
  if (asked && (!asked.settled || (asked.width === width && asked.height === height)))
    return asked.done;
  diag.traceDiagnostic('targets-request', 'GPU frame targets request', () => ({
    frame: run.frame,
    width,
    height,
    previousSize: gpu.targetSize.slice(),
    additionalBytes: capture.captureAllocationBytes,
    hiZReserved: rt.setup.reserveHiz,
  }));
  // Thrown here, synchronously: a size beyond the device's limits releases nothing.
  const targetBytes = frameTargetAllocation(
    rt,
    width,
    height,
    capture.captureAllocationBytes + backdropBytes(rt, width, height),
  );
  // Granted, the record goes; refused, it stays, settled, and holds the frames at this size.
  const done = grantTargets(rt, device, width, height, targetBytes).then(
    (granted) => {
      if (granted) gpu.targetGrant = undefined;
    },
    (error: unknown) => {
      releaseTargets(rt);
      diag.diagnosticFailure('frame-targets-refused', error);
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
 * image, and asks again; refused without it, they are refused by name (`frame-targets-refused`),
 * never as a lost device. Resolves to whether the device granted them.
 */
async function grantTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
  requestedBytes: number,
) {
  const { vis, diag, run } = rt;
  const make = () => makeTargets(rt, device, width, height, requestedBytes),
    stopped = () => run.lost || rt.signal.aborted;
  let made = await deviceMade(device, make);
  // A session stopped meanwhile asks nothing again, and keeps its Hi-Z.
  if (!made && !stopped()) {
    const dropped = vis.gpuHiz ? 'hi-z' : null;
    diag.engineDiagnostic('gpu-out-of-memory', 'The device refused the frame targets', {
      kind: 'warning',
      pool: 'frame-targets',
      requestedBytes,
      dropped,
    });
    if (dropped) {
      dropGpuHiz(rt);
      made = await deviceMade(device, make);
    }
  }
  if (stopped()) {
    made?.destroy();
    return false;
  }
  if (!made) {
    diag.engineDiagnostic('frame-targets-refused', 'The device refused the frame targets', {
      kind: 'error',
      reason: 'gpu-out-of-memory',
      code: 'WEBGPU_FRAME_TARGETS_REFUSED',
      width,
      height,
      requestedBytes,
    });
    return false;
  }
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
