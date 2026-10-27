import { readGpuImage } from '../../gpu/core/readback.ts'
import type { ViewCamera } from '../../camera/world.ts'
import {
  assertCaptureReady,
  captureAside,
  captureImages,
  drawCaptureImages,
  drawResidentCut,
  renderForCapture,
  startCaptureAccumulation,
  stopCaptureAccumulation,
} from './captureAside.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * The composed image of `camera` at `width × height`, drawn aside in a view of its own
 * (`captureAside`) — never presented, so the page's canvas neither resizes nor shows it — and read
 * back bottom row first. The main view's targets and history are left as they were. The view draws
 * `cutViewCaptureDelay` images (`captureImages`), the first being the one that finds the cut whole
 * (`drawResidentCut`), its temporal antialiasing accumulating them (`startCaptureAccumulation`,
 * `drawCaptureImages`), and the last is read; the effect chain, motion blur among it, is not drawn in
 * a capture (`effectsShown`).
 */
export async function captureColorView(
  rt: WebgpuPagesRuntime,
  camera: ViewCamera,
  size: { width: number; height: number },
) {
  const { gpu, context } = rt,
    { device: gpuDevice } = assertCaptureReady(rt),
    images = captureImages(rt)
  return captureAside(rt, size, async () => {
    const aspect = size.width / size.height
    await renderForCapture(rt, camera, aspect)
    await drawResidentCut(rt, camera, aspect, {
      settled: () => startCaptureAccumulation(rt, images),
    })
    await drawCaptureImages(images, (accumulates) => {
      if (!accumulates) stopCaptureAccumulation(rt)
      return renderForCapture(rt, camera, aspect)
    })
    if (!gpu.displayTexture) throw new Error('CAPTURE_NOT_READY')
    return readGpuImage(gpuDevice, gpu.displayTexture, size.width, size.height, context.signal)
  })
}
