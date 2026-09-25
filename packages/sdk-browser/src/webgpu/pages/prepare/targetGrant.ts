import { deviceMade } from '../../../gpu/core/errorScope.ts';
import { dropGpuHiz } from '../io/drops.ts';
import { backdropBytes } from '../../transparent/transmission.ts';
import { frameTargetAllocation, makeTargets, releaseTargets, targetsFit } from './targets.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** What the device still answers for the frame targets, while it answers. */
export function frameTargetsPending(rt: WebgpuPagesRuntime) {
  const grant = rt.gpu.targetGrant;
  return grant && !grant.settled ? grant.done : undefined;
}

/** True while no frame can be drawn: its targets are asked of the device, or were refused at
 *  this size. The frame is then held (`holdWebgpuFrame`), and nothing is presented. */
export function frameTargetsAwaited(rt: WebgpuPagesRuntime) {
  const grant = rt.gpu.targetGrant;
  return !!grant && !grant.granted;
}

/**
 * Asks the device for the frame targets of `width × height`, unless those in place fit, a grant
 * is still in flight — one at a time: its answer asks the next frame (`pendingWebgpuFrame`) —, or
 * this size was already answered. A size the device cannot make is refused at once, by name
 * (`SURFACE_DEVICE_LIMIT`), before anything is released.
 */
export function requestFrameTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  const { gpu, capture, diag, run } = rt;
  if (targetsFit(rt, width, height)) {
    if (gpu.targetGrant?.settled) gpu.targetGrant = undefined;
    return;
  }
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
  const targetBytes = frameTargetAllocation(
    rt,
    width,
    height,
    capture.captureAllocationBytes + backdropBytes(rt, width, height),
  );
  const grant = { width, height, settled: false, granted: false, done: Promise.resolve() };
  gpu.targetGrant = grant;
  grant.done = grantTargets(rt, device, width, height, targetBytes)
    .then(
      (granted) => void (grant.granted = granted),
      (error: unknown) => {
        releaseTargets(rt);
        diag.diagnosticFailure('frame-targets-refused', error);
      },
    )
    .finally(() => (grant.settled = true));
  return grant.done;
}

/**
 * The frame targets of `width × height`, granted before a capture, its restore or prepare draws
 * with them: a grant in flight is waited for first, and a size refused before is asked again.
 * What the device refuses even without Hi-Z is refused by name: `WEBGPU_FRAME_TARGETS_REFUSED`.
 */
export async function grantFrameTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  await frameTargetsPending(rt);
  if (rt.gpu.targetGrant?.settled) rt.gpu.targetGrant = undefined;
  await requestFrameTargets(rt, device, width, height);
  if (frameTargetsAwaited(rt)) throw new Error('WEBGPU_FRAME_TARGETS_REFUSED');
}

/**
 * Out of memory on the frame targets, absorbed as the pools absorb it (`poolGrants.ts`): the
 * targets are made under the device's out-of-memory check (`deviceMade`). The set in place is
 * released first, so a resize never holds two sets at once, and the frames meanwhile are held
 * with nothing presented: the canvas keeps the previous image. A refusal drops Hi-Z first, whose
 * absence changes no image, and asks again; refused without it, the targets are refused by name
 * (`frame-targets-refused`), never reported as a lost device, and the frames stay held until the
 * size changes. Resolves to whether the device granted them.
 */
async function grantTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
  requestedBytes: number,
) {
  const { vis, diag, run } = rt;
  const make = () => makeTargets(rt, device, width, height, requestedBytes);
  let made = await deviceMade(device, make);
  if (!made) {
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
  if (made && (run.lost || rt.signal.aborted)) made.destroy();
  if (run.lost || rt.signal.aborted) return false;
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
  diag.traceDiagnostic('targets-transition', 'GPU targets allocated after transition', () => allocation);
  diag.engineDiagnostic('frame-allocation', 'GPU targets allocated', allocation);
  run.gate.resourcesChanged();
  return true;
}
