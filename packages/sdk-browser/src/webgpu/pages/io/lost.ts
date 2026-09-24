import { claimGpuDevice } from '../../../gpu/core/deviceOwners.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * The one place that declares the device lost, whatever reported it — the device's own `lost`
 * promise, an uncaptured error, a residency read that failed on it, or `dispose`.
 *
 * Everything a lost device leaves behind is older than the device — its resident pages, its
 * colour target, the image it presented — and the two things a consumer could still read are
 * withdrawn here, before any call raises `WEBGPU_LOST` and before the loss is announced:
 *
 * - the presented surface: its context is unconfigured, which replaces the drawing buffer with
 *   a transparent black image, and the presenter is dropped so `presentedSurface` no longer
 *   publishes the canvas — a host composing from it draws as for an engine without one, and a
 *   host canvas the engine presented into goes blank rather than keeping a stale frame;
 * - the held frame: `frameHeld` is cleared, so nothing redisplays the target as this frame.
 *
 * Then, given a cause, the loss is announced once under `gpu-device-lost` with
 * `code: 'WEBGPU_LOST'`, and on the console, since a canvas gone blank says nothing by itself: a
 * host that reacts to it by drawing already finds nothing stale. A dispose gives no cause: it
 * withdraws the same things and announces nothing. Returns true the first time only; the later
 * causes change nothing.
 */
export function markWebgpuLost(
  rt: Pick<WebgpuPagesRuntime, 'run' | 'gpu' | 'diag'>,
  cause?: { reason: string; message: string },
) {
  const { run, gpu, diag } = rt;
  if (run.lost) return false;
  run.lost = true;
  run.frameHeld = false;
  gpu.presenter?.dispose();
  gpu.presenter = undefined;
  if (!cause) return true;
  console.error(`[trillion3d] WebGPU device lost (${cause.reason}): ${cause.message}`);
  diag.engineDiagnostic('gpu-device-lost', 'WebGPU device lost', { code: 'WEBGPU_LOST', ...cause });
  return true;
}

/**
 * Claims `device` for the backend (`gpu/core/deviceOwners.ts`). An uncaptured error of its own
 * abandons the device: what follows would draw on a state no one knows, so it is reported once,
 * as the loss it is, with the error's text — reason `uncaptured-error`, or `out-of-memory` when
 * the device ran out of it. An error of a closed session's is said under
 * `gpu-closed-session-error`, as a warning: it is not this session's.
 */
export function claimWebgpuDevice(
  rt: Pick<WebgpuPagesRuntime, 'run' | 'gpu' | 'diag'>,
  device: GPUDevice,
) {
  return claimGpuDevice(device, {
    error: (message, reason) => markWebgpuLost(rt, { reason, message }),
    closedError: (message) =>
      rt.diag.engineDiagnostic('gpu-closed-session-error', 'WebGPU error of a closed session', {
        kind: 'warning',
        message,
      }),
    lost: (info) => markWebgpuLost(rt, info),
  });
}
