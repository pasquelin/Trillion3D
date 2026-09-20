import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * The one place that declares the device lost, whatever reported it — the device's own `lost`
 * promise, an uncaptured error, a residency read that failed on it, or `dispose`.
 *
 * Everything a lost device leaves behind is older than the device — its resident pages, its
 * colour target, the image it presented — and the two things a consumer could still read are
 * withdrawn here, before any call raises `WEBGPU_LOST`:
 *
 * - the presented surface: its context is unconfigured, which replaces the drawing buffer with
 *   a transparent black image, and the presenter is dropped so `presentedSurface` no longer
 *   publishes the canvas — a host composing from it draws as for an engine without one, and a
 *   host canvas the engine presented into goes blank rather than keeping a stale frame;
 * - the held frame: `frameHeld` is cleared and the resource revision moves, so the witness no
 *   longer matches and nothing redisplays the target as this frame.
 *
 * Returns true the first time only: the caller reports that cause, and the later ones change
 * nothing.
 */
export function markWebgpuLost(rt: Pick<WebgpuPagesRuntime, 'run' | 'gpu'>) {
  const { run, gpu } = rt;
  if (run.lost) return false;
  run.lost = true;
  run.frameHeld = false;
  run.gate.resourcesChanged();
  gpu.presenter?.dispose();
  gpu.presenter = undefined;
  return true;
}
