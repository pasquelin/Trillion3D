import { readGpuImage } from '../../gpu/core/readback.ts'
import type { ViewCamera } from '../../camera/world.ts'
import {
  assertCaptureReady,
  captureAside,
  drawResidentCut,
  renderForCapture,
} from './captureAside.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * The composed image of `camera` at `width × height`, drawn aside in a view of its own
 * (`captureAside`) — never presented, so the page's canvas neither resizes nor shows it — and read
 * back bottom row first. The main view's targets and history are left as they were.
 */
export async function captureColorView(
  rt: WebgpuPagesRuntime,
  camera: ViewCamera,
  size: { width: number; height: number },
) {
  const { gpu, context } = rt,
    { device: gpuDevice } = assertCaptureReady(rt)
  return captureAside(rt, size, async () => {
    const aspect = size.width / size.height
    await renderForCapture(rt, camera, aspect)
    await drawResidentCut(rt, camera, aspect)
    if (!gpu.displayTexture) throw new Error('CAPTURE_NOT_READY')
    return readGpuImage(gpuDevice, gpu.displayTexture, size.width, size.height, context.signal)
  })
}
