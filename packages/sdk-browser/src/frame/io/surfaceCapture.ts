import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { wantsSubsurface, SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import {
  SURFACE_BYTES_PER_PIXEL,
  checkSurfaceSize,
  type SurfaceCapture,
} from '../../materials/surface/surfaceBuffer.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import { createSurfaceBuffer } from '../../materials/surface/surfaceAllocation.ts'
import { collectPendingUrls } from '../../geometry/selection/requests.ts'
import { awaitedPages } from '../../geometry/rows/page/pageSlots.ts'
import { viewProj } from '../backend/helpers.ts'
import type { ViewCamera } from '../../camera/world.ts'
import {
  assertCaptureReady,
  captureAside,
  drawResidentCut,
  renderForCapture,
} from './captureAside.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { CAPTURE_PASS } from '../../diagnostic/stage/passLabels.ts'

type CaptureOptions = { width: number; height: number; signal?: AbortSignal }

/** The depth texture the host owns beside its surfaces; `owned` goes if it cannot be made. */
function ownedDepth(
  gpuDevice: GPUDevice,
  owned: ReturnType<typeof createSurfaceBuffer>,
  options: CaptureOptions,
) {
  try {
    return gpuDevice.createTexture({
      label: 'Trillion3D owned surface depth',
      size: { width: options.width, height: options.height },
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    })
  } catch (error) {
    owned.dispose()
    throw error
  }
}

/** The surfaces and depth of the second view copied into the buffers the host owns, and submitted. */
function copyIntoOwned(
  gpuDevice: GPUDevice,
  surfaces: NonNullable<WebgpuPagesRuntime['gpu']['surfaces']>,
  depthSource: GPUTexture,
  owned: ReturnType<typeof createSurfaceBuffer>,
  depth: GPUTexture,
  options: CaptureOptions,
) {
  const encoder = gpuDevice.createCommandEncoder(),
    size = [options.width, options.height] as const
  /** Layer `from` of `source`'s target `target` copied into layer `to` of the owned one's. */
  const copyLayer = (target: 'colours' | 'words', from: number, to = from) =>
    encoder.copyTextureToTexture(
      { texture: surfaces[target], origin: [0, 0, from] },
      { texture: owned[target], origin: [0, 0, to] },
      size,
    )
  copyLayer('colours', 0)
  copyLayer('colours', 1)
  copyLayer('words', SURFACE_WORDS.flags)
  encoder.copyTextureToTexture({ texture: depthSource }, { texture: depth }, size)
  // A view without the emission-and-occlusion layer holds `(0, 0, 0, 1)` in every texel of it
  // (`SurfaceBuffer.hasEmissiveAo`): the owned layer is cleared to that, never copied from the 1×1.
  if (surfaces.hasEmissiveAo) copyLayer('colours', surfaces.layers & 255, owned.layers & 255)
  else
    encoder
      .beginRenderPass({
        label: CAPTURE_PASS,
        colorAttachments: [
          {
            view: owned.views()[2],
            loadOp: 'clear',
            clearValue: [0, 0, 0, 1],
            storeOp: 'store',
          },
        ],
      })
      .end()
  if (surfaces.hasSubsurface)
    copyLayer('colours', (surfaces.layers >> 8) & 255, (owned.layers >> 8) & 255)
  gpuDevice.queue.submit([encoder.finish()])
}

/** Copies the surfaces of the second view into buffers the host owns until it disposes them. */
function copySurfaces(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  options: CaptureOptions,
  reserve: number,
): SurfaceCapture {
  const { gpu, capture, diag } = rt,
    eye = rt.run.gate.cam.eye
  if (!gpu.surfaces || !gpu.depthTexture) throw new Error('SURFACE_CAPTURE_UNAVAILABLE')
  const owned = createSurfaceBuffer(gpuDevice, options.width, options.height, {
    subsurface: gpu.surfaces.hasSubsurface,
  })
  const depth = ownedDepth(gpuDevice, owned, options)
  let released = false
  const result: SurfaceCapture = {
    ...owned,
    allocationBytes: reserve,
    depth,
    inverseViewProjection: [...invertMatrix4(new Float64Array(16), viewProj)],
    // The second view has just entered through the contract: its world eye is the one the engine
    // camera carries, without rereading the host camera or recomputing anything.
    cameraWorld: [eye[0], eye[1], eye[2]],
    selectedTriangles: rt.run.selectedTriangles,
    dispose() {
      if (released) return
      released = true
      owned.dispose()
      depth.destroy()
      capture.captureAllocationBytes = 0
      capture.surfaceCapture = undefined
      diag.engineDiagnostic('surface-capture-released', 'GPU capture released', {
        allocationBytes: reserve,
      })
    },
  }
  copyIntoOwned(gpuDevice, gpu.surfaces, gpu.depthTexture, owned, depth, options)
  return result
}

/** Before the cover is resident a view's cut publishes nothing (`../render/gpuCut.ts`): the capture's
 *  own `desired` is still empty, so it awaits the cover. Throws while a page it needs is missing. */
function requirePagesResident(rt: WebgpuPagesRuntime) {
  const { run } = rt
  const asked = rt.services.bootstrapState.ready ? run.desired : rt.layout.gpuWanted
  const missing = collectPendingUrls(awaitedPages(asked, run.awaitedScratch), [])
  if (missing.length) throw new Error(`SURFACE_PAGES_NOT_RESIDENT: ${missing.length}`)
  if (run.coverageBudgetLimited) throw new Error('SURFACE_PAGE_BUDGET')
}

/** The capture is ready: said, with what it holds and what it took. */
function reportSurfaceReady(
  rt: WebgpuPagesRuntime,
  options: CaptureOptions,
  reserve: number,
  started: number,
) {
  const { run, diag } = rt
  diag.engineDiagnostic('surface-capture-ready', 'Surface GPU ready', {
    surfaceVersion: 1,
    width: options.width,
    height: options.height,
    selectedTriangles: run.selectedTriangles,
    allocationBytes: reserve,
    durationMs: msSince(started),
    imageReadback: false,
  })
}

/** Renders a second camera into owned material surfaces, in a view of its own (`captureAside`). */
export async function captureSurfaceView(
  rt: WebgpuPagesRuntime,
  camera: ViewCamera,
  options: CaptureOptions,
) {
  const { run, capture, context, diag } = rt
  context.signal?.throwIfAborted()
  options.signal?.throwIfAborted()
  const { device: gpuDevice } = assertCaptureReady(rt, 'SURFACE_CAPTURE_UNAVAILABLE')
  // The owned surfaces and depth. Other views and temporal histories stay live and are
  // charged once by the device ledger during admission, not again as owned capture bytes.
  const reserve =
    checkSurfaceSize(gpuDevice, options.width, options.height, SURFACE_BYTES_PER_PIXEL + 4) +
    SUBSURFACE_TARGET.bytes(options.width, options.height, wantsSubsurface(rt))
  // Capture entry: the camera comes from the host like an image's, and the engine reads it as
  // it reads any other — resolved pose, declared optics — at the aspect ratio of the surface
  // written into rather than the one the camera declares for the host's own canvas.
  const aspect = options.width / options.height
  const started = cpuNow()
  const throwIfAborted = () => {
    options.signal?.throwIfAborted()
    context.signal?.throwIfAborted()
  }
  const diagnostic = run.diagnostic
  let result: SurfaceCapture | undefined
  capture.captureAllocationBytes = reserve
  diag.engineDiagnostic('surface-capture-start', 'GPU capture from a second camera', {
    width: options.width,
    height: options.height,
    allocationBytes: reserve,
  })
  try {
    await captureAside(rt, options, async () => {
      throwIfAborted()
      run.diagnostic = 'beauty'
      await renderForCapture(rt, camera, aspect)
      await drawResidentCut(rt, camera, aspect, {
        admitted: () => requirePagesResident(rt),
        beforeEncode: throwIfAborted,
      })
      result = copySurfaces(rt, gpuDevice, options, reserve)
      await gpuDevice.queue.onSubmittedWorkDone()
      throwIfAborted()
      if (run.lost) throw new Error('WEBGPU_LOST')
    })
  } catch (error) {
    result?.dispose()
    capture.captureAllocationBytes = 0
    diag.diagnosticFailure('surface-capture-failed', error)
    throw error
  } finally {
    run.diagnostic = diagnostic
  }
  capture.surfaceCapture = result
  reportSurfaceReady(rt, options, reserve, started)
  return result!
}
