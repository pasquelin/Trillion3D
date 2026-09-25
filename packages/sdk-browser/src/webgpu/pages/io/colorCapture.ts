import { readGpuImage } from '../../../gpu/core/presentation.ts';
import { resetHizHistory } from './drops.ts';
import { restartCameraMotion } from '../../../camera/motion.ts';
import type { HostCamera } from '../../../camera/world.ts';
import {
  drawResidentCut,
  renderForCapture,
  restoreMainView,
  type SavedView,
} from './surfaceRestore.ts';
import { shadowPoolPending, sizeShadowPool } from '../../shadow/poolSize.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * The composed image of `camera` at `width × height`, drawn aside: the frame is rendered at that
 * size into the engine's own colour target — never presented, so the page's canvas neither
 * resizes nor shows it — read back bottom row first, and the main view is then restored the way
 * a surface capture restores it (`surfaceRestore.ts`).
 */
export async function captureColorView(
  rt: WebgpuPagesRuntime,
  camera: HostCamera,
  size: { width: number; height: number },
) {
  const { run, capture, gpu, context } = rt,
    { viewport } = rt.setup,
    gpuDevice = gpu.device;
  if (capture.capturing || capture.surfaceCapture)
    throw new Error('SURFACE_CAPTURE_BUSY: dispose the previous capture first');
  if (run.lost || !gpuDevice || !run.lastCamera) throw new Error('CAPTURE_NOT_READY');
  const saved: SavedView = {
    main: run.lastCamera,
    size: [viewport[0], viewport[1]],
    diagnostic: run.diagnostic,
    motion: { ...run.motion },
  };
  // A light that casts asks its shadow pool of the device before anything is drawn: the capture
  // waits for the answer, never drawn without its shadows (#483). The pool is sized from the
  // canvas, before the capture's own size takes the viewport.
  sizeShadowPool(rt);
  capture.capturing = true;
  let pixels: Uint8Array | undefined;
  try {
    await shadowPoolPending(rt);
    await rt.services.residency.pending;
    await gpuDevice.queue.onSubmittedWorkDone();
    viewport[0] = size.width;
    viewport[1] = size.height;
    resetHizHistory(run);
    restartCameraMotion(run.motion);
    renderForCapture(rt, camera, size.width / size.height);
    await drawResidentCut(rt, gpuDevice);
    if (!gpu.colorTexture) throw new Error('CAPTURE_NOT_READY');
    pixels = await readGpuImage(
      gpuDevice,
      gpu.colorTexture,
      size.width,
      size.height,
      context.signal,
    );
  } finally {
    await restoreMainView(rt, gpuDevice, saved);
  }
  return pixels;
}
