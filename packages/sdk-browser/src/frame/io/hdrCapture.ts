import type { HostCamera } from '../../camera/world.ts'
import {
  prepareSurfaceRewrite,
  releaseSurfaceRewrite,
} from '../../lighting/deferred/surfaceOverride.ts'
import { rewritesSurfaces, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { captureAside, drawResidentCut, renderForCapture } from './captureAside.ts'

/** What `captureHdrViews` draws: the cameras, one image each, square, `size` pixels a side, with
 *  the overrides of the views, and what takes each lit image away. */
export interface HdrViewsJob {
  readonly size: number
  readonly cameras: readonly HostCamera[]
  readonly overrides: ViewOverrides
  /** Encodes what takes the lit image of camera `at` — linear HDR, level 0 of the HDR target, no
   *  exposure, no effect, no tone curve — to its place: `drawn` is the size drawn in it, of the
   *  target `allocated`. Called by every image drawn, the last one standing. */
  copy(
    encoder: GPUCommandEncoder,
    lit: GPUTextureView,
    drawn: readonly number[],
    allocated: readonly number[],
    at: number,
  ): void
}

/**
 * The lit linear HDR image of each camera of `job`, one after the other, drawn aside in a view of
 * its own (`captureAside`) that holds the job's overrides: no effect chain, no exposure, no tone
 * curve — the image the lighting wrote, taken away by the job's copy before the radiance turn —,
 * never presented. A camera's cut is drawn whole before the next (`drawResidentCut`); the main
 * view's targets, cut and history are left as they were.
 */
export async function captureHdrViews(rt: WebgpuPagesRuntime, job: HdrViewsJob) {
  const { run, capture, gpu } = rt,
    device = gpu.device
  if (capture.capturing || capture.surfaceCapture)
    throw new Error('SURFACE_CAPTURE_BUSY: dispose the previous capture first')
  const main = run.lastCamera
  if (run.lost || !device || !main) throw new Error('CAPTURE_NOT_READY')
  if (rewritesSurfaces(job.overrides)) await prepareSurfaceRewrite(device)
  const size = { width: job.size, height: job.size }
  try {
    await captureAside(
      rt,
      size,
      async () => {
        for (const [at, camera] of job.cameras.entries()) {
          let taken = false
          // The projection has no far plane, and the camera of a face keeps none; a camera that
          // names a finite one is held to the scene's.
          if (Number.isFinite(camera.far)) camera.far = Math.max(main.far, camera.near * 2)
          rt.views.active.overrides = {
            ...job.overrides,
            readLit: (encoder, lit, drawn, allocated) => {
              taken = true
              job.copy(encoder, lit, drawn, allocated, at)
            },
          }
          await renderForCapture(rt, camera, 1)
          await drawResidentCut(rt, camera, 1)
          // The aside targets are drawn into again by the next camera.
          await device.queue.onSubmittedWorkDone()
          // An image never drawn leaves nothing to take: the capture is refused, not made blank.
          if (!taken) throw new Error('CAPTURE_NOT_READY: no image was drawn for a camera')
        }
      },
      job.overrides,
    )
  } finally {
    releaseSurfaceRewrite(device)
  }
}
