import { createSynchronousCanvasCapture } from '../../../gpu/core/presentation.ts'
import type { VisPage } from '../../../visibility/types.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { frameTargetsAwaited } from '../prepare/targetGrant.ts'
import { defaultEngineCamera } from '../../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

export { pageUrls, pendingUrls, retainedRanks } from './hostLists.ts'

/**
 * The contract's light store has changed. Nothing is recomputed here: the next image rereads the
 * store, pushes the buffer again if its revision moved, and the shadow scheduler takes over. The
 * cached capture is invalidated so the host does not reread the image from before the light.
 */
export function refreshSceneLights(rt: WebgpuPagesRuntime) {
  const { lights } = rt
  rt.capture.capturedRevision = -1
  // Origin of the scene change: a declared light was added, set or removed.
  rt.run.gate.sceneChanged()
  rt.diag.engineDiagnostic('direct-lighting-changed', 'Contract lights updated', {
    version: 1,
    lights: lights.store.count,
    view: lights.store.lightingView,
    unlit: lights.store.unlit,
    exposure: lights.store.environment?.exposure ?? 1,
  })
}

/** Re-renders the last camera once new pages arrived, unless a readback is holding the image. */
export function syncResident(rt: WebgpuPagesRuntime) {
  const { run, gpu, capture } = rt
  if (capture.capturing) return
  if (run.lost || !gpu.device || !gpu.cache || !run.lastCamera) return
  // Page bytes are already accepted. Keep the submitted image stable until its
  // explicit readback completes; the next render selects/uploads those bytes.
  if (capture.capturePending) {
    capture.captureStreamingDeferrals++
    return
  }
  // A complete cut is reselected for the latest camera; CPU arrival alone
  // never authorizes replacing any region's GPU fallback.
  // Origin of the resource change: residency just moved under the held image.
  run.gate.resourcesChanged()
  renderWebgpuPages(rt, run.lastCamera)
}

/** The current image, read synchronously through the presenter's canvas when no flush settled it. */
export function captureImage(rt: WebgpuPagesRuntime) {
  const { run, gpu, capture, diag } = rt,
    gpuDevice = gpu.device
  if (run.lost) throw new Error('WEBGPU_LOST')
  if (capture.capturedPixels && capture.capturedRevision === run.imageRevision)
    return capture.capturedPixels
  // Targets not granted hold no image: presenting them would blank the canvas.
  const busy = capture.capturing || frameTargetsAwaited(rt)
  if (!gpu.presenter || !gpuDevice || !gpu.displayTexture || busy)
    throw new Error('CAPTURE_NOT_READY: render then await flush before capture')
  // The canvas read below already holds the image when the last frame presented it whole.
  if (!gpu.presenter.holds(gpu.displayTexture, ...gpu.displaySize)) {
    const encoder = gpuDevice.createCommandEncoder()
    gpu.presenter.present(encoder, gpu.displayTexture, ...gpu.displaySize)
    gpuDevice.queue.submit([encoder.finish()])
  }
  if (!gpu.synchronousCapture) {
    gpu.synchronousCapture = createSynchronousCanvasCapture()
    diag.engineDiagnostic('capture-synchronous', 'Synchronous read requested by the host', {
      outsideBeauty: true,
      prefer: 'await flush(); capture()',
    })
  }
  capture.capturedPixels = gpu.synchronousCapture.read(gpu.presenter.canvas)
  capture.capturedRevision = run.imageRevision
  return capture.capturedPixels
}

/** The drawn opaque pages with their bytes, as the CPU raster oracle reads them, and the packed
 *  rank of each — one record serves many placements. */
function drawnOpaquePages(rt: WebgpuPagesRuntime) {
  const pages: VisPage[] = [],
    packed: number[] = []
  for (let i = 0; i < rt.run.drawn.length; i++) {
    const rec = rt.run.drawn[i]
    if (rec.array && !rec.transparent) {
      pages.push({ ...rec, array: rec.array })
      packed.push(rt.run.drawnPacked[i])
    }
  }
  return { pages, packed }
}

/** Camera the oracles read: the last image's, or a fresh host camera's while no image has been
 *  rendered. */
function engineCameraOf(rt: WebgpuPagesRuntime) {
  return rt.run.lastCamera ? rt.run.gate.cam : defaultEngineCamera()
}

/** What the CPU raster oracles read of the last image: its drawn pages, their locations, camera,
 *  size, pixel ratio and clear colour. The oracles themselves live in `bench/oracles`. */
export const rasterView = (rt: WebgpuPagesRuntime) => {
  const { pages, packed } = drawnOpaquePages(rt)
  return {
    pages,
    locations: {
      roots: rt.layout.selectionRoots,
      packed,
      rootOfPacked: rt.layout.placement.rootOfPacked,
    },
    cam: engineCameraOf(rt),
    size: rt.setup.viewport ?? rt.gpu.targetSize,
    pixelRatio: rt.setup.pixelRatio(),
    clearColor: rt.run.clearColor,
  }
}
