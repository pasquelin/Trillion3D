import { upscaleMipBias } from '../../../post/taa/jitter.ts'
import {
  renderAllocation,
  renderExtent,
  type RenderScaleBounds,
} from '../../scale/renderScaleOption.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { frameStart } from '../../scheduling.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'
import { taaWanted } from './gpu.ts'

/**
 * The drawn view's render-scale bounds where its frame may be drawn below the display: the page
 * asked a scale below 1, which the temporal resolve rebuilds or, where none runs, the composition
 * upscales — the dynamic resolution runs with either, the same bounds with or without an
 * upscaler. A diagnostic view keeps the view's targets, drawn in them at the pixel centre
 * (`beginTaaFrame`): switching to it remakes none. A capture, at the display's scale, and a
 * diagnostic GPU variant, which sizes its own targets, stay at the display's size: `undefined`.
 * The bounds are those `frameSizeOf` last fitted to the view's size.
 */
function scaledBounds(rt: WebgpuPagesRuntime): RenderScaleBounds | undefined {
  const { bounds } = rt.views.active.scale
  const scaled = !rt.capture.capturing && !rt.context.diagnosticGpuVariant
  return scaled && bounds.min < 1 ? bounds : undefined
}

/** Whether the view's temporal pass runs this image: rigged, switched on, a lit image other than
 *  the view that bypasses it (`no-temporal-aa`, which draws as the pass switched off). It then
 *  runs on every image until its history is whole, then the still view is held on its converged
 *  image (`taaConverging`, `holdWebgpuFrame`). A capture holds a pass only for the images that
 *  accumulate (`startCaptureAccumulation`): the others hold none, or have it off, and run none. */
export const taaRuns = (rt: WebgpuPagesRuntime) =>
  !!rt.gpu.temporal &&
  taaWanted(rt.gpu) &&
  drawsLit(rt.run.diagnostic) &&
  rt.run.diagnostic !== 'no-temporal-aa'

/** Render pixels per CSS pixel: the host's ratio times the render-to-display one, so a line drawn
 *  below the display keeps its display width. The host's own at native size. */
export const renderPixelRatio = (rt: WebgpuPagesRuntime) =>
  rt.setup.pixelRatio() * (rt.gpu.targetSize[0] / rt.gpu.displaySize[0])

/** Texture level offset of the frame (`upscaleMipBias`), the same for the read and the request:
 *  the automatic view mip bias where the temporal pass runs (`taaRuns`), zero where it does
 *  not. */
export const renderMipBias = (rt: WebgpuPagesRuntime) =>
  upscaleMipBias(rt.gpu.targetSize[0], rt.gpu.displaySize[0], taaRuns(rt))

/** A frame's sizes: the display's, the one its render targets are made at, and whether the display
 *  colour is a target apart, which the resolve reconstructs a frame drawn below the display into. */
export interface FrameSize {
  width: number
  height: number
  renderWidth: number
  renderHeight: number
  apart: boolean
}

/** The drawn view's size, the key a memory cap of the render scale is learnt at (`capMemory`), kept
 *  on the view (`WebgpuView.sizeKey`): its string made again only when its viewport changes. */
export const viewKey = (rt: WebgpuPagesRuntime) => {
  const [width, height] = rt.setup.viewport,
    view = rt.views.active
  const key = view.sizeKey
  if (key && key.width === width && key.height === height) return key.text
  view.sizeKey = { width, height, text: `${width}x${height}` }
  return view.sizeKey.text
}

/** Whether the drawn view's targets follow the controller's bounds (`ScaleControl.allocated`): only
 *  then may a memory cap lower them (`ScaleControl.capMemory`). */
export const scalesTargets = (rt: WebgpuPagesRuntime) => !!scaledBounds(rt)

/** The drawn view's frame size, written into `into`: its viewport, and that at the scale its
 *  targets are made at — the bounds' maximum under a memory cap (`ScaleControl.allocated`),
 *  whatever the scale drawn in them, which the temporal resolve rebuilds or the composition
 *  upscales (`../../../lighting/deferred/shaders.ts`); the display's own where no frame is drawn
 *  below it. The display colour is apart whenever a frame may be drawn below it. `full`: at the
 *  bounds' maximum, the largest the targets are ever made at for this viewport — what a default
 *  budget funds. The bounds are first fitted to the view's drawing-buffer size, which the
 *  default render fraction follows (`ScaleControl.fit`): the targets are sized before any image of
 *  the frame is drawn. */
export function frameSizeOf(rt: WebgpuPagesRuntime, into: FrameSize, full = false) {
  const [w, h] = rt.setup.viewport
  // A capture draws at its own size, at the display's scale: the view's bounds stay its own.
  if (!rt.capture.capturing) rt.views.active.scale.fit(w, h)
  const bounds = scaledBounds(rt),
    scale = !bounds ? 1 : full ? bounds.max : rt.views.active.scale.allocated(viewKey(rt))
  into.width = Math.max(1, w)
  into.height = Math.max(1, h)
  into.renderWidth = renderAllocation(into.width, scale)
  into.renderHeight = renderAllocation(into.height, scale)
  into.apart = !!bounds
  return into
}

/** True when `a` and `b` are the same frame size, all sizes alike. */
export const sameFrameSize = (a: FrameSize, b: FrameSize) =>
  a.width === b.width &&
  a.height === b.height &&
  a.renderWidth === b.renderWidth &&
  a.renderHeight === b.renderHeight &&
  a.apart === b.apart

/** True when the targets hold a display colour of its own, which the resolve reconstructs into. */
export const displayApart = (gpu: WebgpuPagesRuntime['gpu']) =>
  !!gpu.displayTexture && gpu.displayTexture !== gpu.colorTexture

/** The size an image drawn at `scale` takes in the targets, written into `out`: what `drawFrameAt` sets as `gpu.targetSize`. */
export function renderedSize(rt: WebgpuPagesRuntime, scale: number, out: number[]) {
  const { allocatedSize, displaySize } = rt.gpu,
    apart = displayApart(rt.gpu)
  for (let i = 0; i < 2; i++)
    out[i] = apart
      ? Math.min(allocatedSize[i], renderExtent(displaySize[i], scale))
      : allocatedSize[i]!
}

const drawnSize = [0, 0]

/**
 * Draws this image at `scale` in the targets in place, made at the bounds' maximum (`frameSizeOf`):
 * the image is drawn in their top-left `targetSize`, the view's exact size (`renderExtent`), the targets
 * themselves aligned (`renderAllocation`). Where the display colour is not apart, the
 * targets' whole size. The Hi-Z pyramid is built over it (`GpuHiz.extent`); the last image's still
 * stands for the cut's next main pass, read in that image's pixels through the levels it was built
 * with (`../../render/cutPyramid.ts`). `views.active.scale.drawn`
 * reads back the size drawn: `scale` where the targets hold its extent (`renderExtent`), else the
 * share of the display they hold — an image of another size than the controller's, which it does
 * not measure; `steered`, an image the controller measures (`ScaleControl.drew`).
 */
export function drawFrameAt(rt: WebgpuPagesRuntime, scale: number, steered = false) {
  const { gpu } = rt,
    { displaySize, targetSize } = gpu,
    apart = displayApart(gpu)
  renderedSize(rt, scale, drawnSize)
  const [width, height] = drawnSize as [number, number]
  targetSize[0] = width
  targetSize[1] = height
  rt.vis.gpuHiz?.extent(width, height)
  const drawn = !apart
    ? 1
    : width === renderExtent(displaySize[0], scale)
      ? scale
      : width / displaySize[0]
  rt.views.active.scale.drew(drawn, apart && steered && drawn === scale)
}

/** The scale and steering the drawn view's next image takes (`drawFrameAt`): `bypass` where its temporal pass does not run (no pass, or
 *  switched off), which the composition upscales spatially where the targets are scaled, else the bounds' maximum. */
export function scaleOfImage(rt: WebgpuPagesRuntime, bypass: boolean) {
  const { scale } = rt.views.active
  if (bypass && !scalesTargets(rt)) {
    chosen.scale = scale.bounds.max
    chosen.steered = scale.bounds.max === scale.wanted()
  } else {
    chosen.scale = scale.wanted()
    chosen.steered = !rt.run.textureConverging
  }
  return chosen
}
const chosen = { scale: 1, steered: false }

/** The frame each runtime's main view was counted ahead for (`countMainImage`). */
const countedAhead = new WeakMap<WebgpuPagesRuntime, number>()

/**
 * Counts the main view's image about to be drawn: its scale controller reads the display's cadence at the frame's start, and the image is
 * numbered among the main view's. The image's entry does it (`ahead` false); a pass that must know the size of the image before then
 * (the custom depth) does it first (`ahead`), and the entry of the same frame leaves it as done.
 */
export function countMainImage(rt: WebgpuPagesRuntime, ahead = false) {
  const at = frameStart()
  if (!ahead && countedAhead.get(rt) === at) {
    countedAhead.delete(rt)
    return
  }
  if (ahead) countedAhead.set(rt, at)
  rt.views.main.scale.tick(at, rt.timing.gpuTiming?.supported === true)
  rt.views.mainImages++
}
