import type { HostCamera } from '../../../camera/world.ts'
import { drawnTrianglesOf } from './drawnTriangles.ts'
import { viewTargetBytes } from './gpu.ts'
import type { ViewFrameMetrics } from '../../../../../sdk-core/src/contracts/metrics.ts'
import { rigViewTemporal, setWebgpuTemporalAntialiasing } from '../../../post/taa/prepare.ts'
import { temporalAntialiasingLevel } from '../../../../../sdk-core/src/contracts/materialOptions.ts'
import type { TemporalAntialiasingLevel } from '../../../../../sdk-core/src/contracts/compilerAbi.ts'
import { releaseSettledCapture } from '../../io/captureAside.ts'
import { renderWebgpuPages } from '../../render/render.ts'
import { createViewGpuTiming } from '../../prepare/timing.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { PresentRect } from '../../../gpu/core/presentAt.ts'
import { createGpuPresenter } from '../../../gpu/core/presentation.ts'
import { createViewScale } from '../../view/viewScale.ts'
import type { RenderScale } from '../../scale/renderScaleOption.ts'
import { createWebgpuView, viewGpu, type WebgpuView } from './view.ts'
import { onView } from './viewSwitch.ts'

/** Where a view drawn beside the main one presents, and how it draws (`world.addView`). */
export interface WebgpuViewOptions {
  /** A canvas of its own, which it presents into whole at its drawing buffer's size. */
  canvas?: HTMLCanvasElement
  /** Without `canvas`, a rectangle of the main view's canvas, in canvas pixels. */
  rect?: PresentRect
  /** Its render scale (`createViewScale`); `'auto'` by default. */
  renderScale?: RenderScale
  /** Its own temporal antialiasing's level, `false` or `'off'` none; the default level by
   *  default. */
  temporalAntialiasing?: boolean | TemporalAntialiasingLevel
}

/** Whole canvas pixels: the present packs the origin into an integer (`presentAt.ts`). */
const wholeRect = (rect: PresentRect): PresentRect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.max(1, Math.round(rect.width)),
  height: Math.max(1, Math.round(rect.height)),
})

/**
 * A VIEW DRAWN BESIDE THE MAIN ONE, which `world.addView` wraps: the capture's view
 * (`../../io/captureAside.ts`), kept and drawn every frame it is asked from a camera of its own,
 * presented into a canvas of its own or at a rectangle of the main view's. It holds its own cut,
 * targets, held frame, Hi-Z pyramid, anti-aliasing history, effect chain, GPU timer and render
 * scale; everything else is the scene's and is shared (`./view.ts`). It is no capture, so texture
 * feedback, the effect chain, the distortion and the particles it draws are all its own. The main view is
 * drawn first each frame: on its canvas, its presentation clears it and the views placed there
 * keep what it shows.
 */
export async function addWebgpuView(rt: WebgpuPagesRuntime, options: WebgpuViewOptions) {
  const device = rt.gpu.device
  if (!device) throw new Error('WEBGPU_UNAVAILABLE')
  const at = options.canvas
    ? undefined
    : wholeRect(options.rect ?? { x: 0, y: 0, width: 1, height: 1 })
  const width = at?.width ?? Math.max(1, options.canvas!.width),
    height = at?.height ?? Math.max(1, options.canvas!.height)
  const scale = createViewScale(options.renderScale ?? 'auto', rt.views.main.scale)
  const view = createWebgpuView(width, height, scale, true)
  view.rect = at
  view.gpu.temporalLevel = temporalAntialiasingLevel(options.temporalAntialiasing)
  const presenter = options.canvas
    ? createGpuPresenter(device, options.canvas)
    : viewGpu(rt, rt.views.main).presenter
  view.gpu.presenter = presenter
  view.timing.gpuTiming = createViewGpuTiming(rt, device, view)
  rt.views.persistent.push(view)
  try {
    // What presents it, compiled before its first frame does; refused, its present asks it again
    // and the device says why, as any refused pipeline.
    await Promise.all([rigViewTemporal(rt, view), presenter?.preparePlaced().catch(() => {})])
  } catch (error) {
    // Never handed to the caller, it would never leave: it leaves now.
    await removeWebgpuView(rt, view)
    throw error
  }
  return {
    view,
    /** Another render scale, from its next image. */
    setRenderScale: (next: RenderScale) => (scale.set(next), rt.run.gate.resourcesChanged()),
    /** Its temporal antialiasing's level, `'off'` none, from its next image. */
    setTemporalAntialiasing: (level: TemporalAntialiasingLevel) =>
      setWebgpuTemporalAntialiasing(rt, level, view),
  }
}

/** A view on a canvas of its own takes the size of its drawing buffer, `width × height`, from its
 *  next image; one placed on the main canvas, `rect`. */
export function resizeWebgpuView(
  view: WebgpuView,
  width: number,
  height: number,
  rect?: PresentRect,
) {
  if (rect && view.rect) view.rect = wholeRect(rect)
  view.viewport[0] = Math.max(1, Math.round(rect ? view.rect!.width : width))
  view.viewport[1] = Math.max(1, Math.round(rect ? view.rect!.height : height))
}

/** Draws `view` from `camera` at its viewport's shape, then the main view is drawn again; the
 *  frame counts as held only when the main view's and this one's both are. Returns what the image
 *  cost and drew. */
export function renderWebgpuView(
  rt: WebgpuPagesRuntime,
  view: WebgpuView,
  camera: HostCamera,
  index: number,
): ViewFrameMetrics {
  const { run, capture, views } = rt
  if (!views.persistent.includes(view)) throw new Error('VIEW_RELEASED')
  if (capture.capturing) throw new Error('SURFACE_CAPTURE_BUSY')
  const mainHeld = run.frameHeld
  view.every = views.mainImages - (view.drawnBeside ?? views.mainImages - 1)
  view.drawnBeside = views.mainImages
  const metrics = onView(rt, view, drawView, camera)
  metrics.index = index
  run.frameHeld &&= mainHeld
  return metrics
}

/** Draws the drawn view from `camera` at its viewport's shape, and returns its metrics. */
function drawView(rt: WebgpuPagesRuntime, camera: HostCamera) {
  const [width, height] = rt.setup.viewport
  renderWebgpuPages(rt, camera, width / height)
  return viewMetrics(rt, rt.views.active)
}

/** The drawn view's image, written into the record the view keeps — no frame allocates one —: its
 *  timer's last sample, its size and scale, what it drew and holds. */
function viewMetrics(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const { gpu, timing, run } = rt
  const metrics = (view.metrics ??= {} as ViewFrameMetrics)
  metrics.gpuFrameMs = timing.lastGpuFrameMs
  metrics.gpuPassMs = timing.lastGpuPassMs
  metrics.renderWidth = gpu.targetSize[0]
  metrics.renderHeight = gpu.targetSize[1]
  metrics.renderScale = view.scale.drawn
  metrics.drawnTriangles = drawnTrianglesOf(run, rt.vis.gpuPartition?.counts())
  metrics.frameTargetBytes = viewTargetBytes(gpu)
  return metrics
}

/** `view` leaves: once the device has answered what it asked, its targets, pyramid, history,
 *  effect chain, timer and canvas are released, and its cut leaves the residency's union. */
export async function removeWebgpuView(rt: WebgpuPagesRuntime, view: WebgpuView) {
  const at = rt.views.persistent.indexOf(view)
  if (at < 0) return
  rt.views.persistent.splice(at, 1)
  rt.lights.vsm?.state.cache.dropView(view.id)
  await releaseSettledCapture(rt, view)
}
