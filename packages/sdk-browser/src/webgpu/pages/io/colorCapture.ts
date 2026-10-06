import { readGpuImage } from '../../../gpu/core/presentation.ts'
import type { HostCamera } from '../../../camera/world.ts'
import { captureAside, drawResidentCut, renderForCapture } from './captureAside.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * The composed image of `camera` at `width × height`, drawn aside in a view of its own
 * (`captureAside`) — never presented, so the page's canvas neither resizes nor shows it — and read
 * back bottom row first. The main view's targets and history are left as they were.
 */
export async function captureColorView(
  rt: WebgpuPagesRuntime,
  camera: HostCamera,
  size: { width: number; height: number },
) {
  const { run, capture, gpu, context } = rt,
    gpuDevice = gpu.device
  if (capture.capturing || capture.surfaceCapture)
    throw new Error('SURFACE_CAPTURE_BUSY: dispose the previous capture first')
  if (run.lost || !gpuDevice || !run.lastCamera) throw new Error('CAPTURE_NOT_READY')
  return captureAside(rt, size, async () => {
    await renderForCapture(rt, camera, size.width / size.height)
    await drawResidentCut(rt, gpuDevice)
    if (!gpu.displayTexture) throw new Error('CAPTURE_NOT_READY')
    return readGpuImage(gpuDevice, gpu.displayTexture, size.width, size.height, context.signal)
  })
}
