import { upscaleMipBias } from '../../../taa/jitter.ts';
import { renderExtent, type RenderScaleBounds } from '../../../frame/renderScaleOption.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

export { renderExtent };

/**
 * The session's render-scale bounds where the drawn view's frame may be drawn below the display:
 * the temporal resolve reconstructs it — its pass rigged and wanted, in the beauty view, on the
 * visibility buffer, its upscaling resolves compiled —, and the page asked a scale below 1. A
 * capture — drawn in a view of its own, which holds no pass —, a diagnostic view, which renders at
 * the pixel centre, a diagnostic GPU variant, which sizes its own targets, and the fallback draw
 * stay at the display's size: `undefined`.
 */
function scaledBounds(rt: WebgpuPagesRuntime): RenderScaleBounds | undefined {
  const { gpu, run, vis } = rt,
    { bounds } = rt.scale;
  const reconstructed =
    !!gpu.temporal &&
    gpu.temporalWanted &&
    run.diagnostic === 'beauty' &&
    !rt.context.diagnosticGpuVariant &&
    vis.visEnabled;
  return reconstructed && bounds.min < 1 && gpu.temporal!.upscales() ? bounds : undefined;
}

/** Render pixels per CSS pixel: the host's ratio times the render-to-display one, so a line drawn
 *  below the display keeps its display width. The host's own at native size. */
export const renderPixelRatio = (rt: WebgpuPagesRuntime) =>
  rt.setup.pixelRatio() * (rt.gpu.targetSize[0] / rt.gpu.displaySize[0]);

/** Texture level offset of the frame (`upscaleMipBias`), the same for the read and the request:
 *  zero at native size. */
export const renderMipBias = (rt: WebgpuPagesRuntime) =>
  upscaleMipBias(rt.gpu.targetSize[0], rt.gpu.displaySize[0]);

/** A frame's sizes: the display's, the one its render targets are made at, and whether the display
 *  colour is a target apart, which the resolve reconstructs a frame drawn below the display into. */
export interface FrameSize {
  width: number;
  height: number;
  renderWidth: number;
  renderHeight: number;
  apart: boolean;
}

/** The drawn view's frame size, written into `into`: its viewport, and that at the scale its
 *  targets are made at — the drawn one, up to the next eighth (`ScaleControl.allocated`), so a
 *  frame drawn at half the display allocates a quarter of its pixels (#1343). The display colour
 *  is apart whenever a frame may be drawn below it. */
export function frameSizeOf(rt: WebgpuPagesRuntime, into: FrameSize) {
  const bounds = scaledBounds(rt),
    scale = bounds ? rt.scale.allocated() : 1;
  into.width = Math.max(1, rt.setup.viewport[0]);
  into.height = Math.max(1, rt.setup.viewport[1]);
  into.renderWidth = renderExtent(into.width, scale);
  into.renderHeight = renderExtent(into.height, scale);
  into.apart = !!bounds;
  return into;
}

/** True when `a` and `b` are the same frame size, all sizes alike. */
export const sameFrameSize = (a: FrameSize, b: FrameSize) =>
  a.width === b.width &&
  a.height === b.height &&
  a.renderWidth === b.renderWidth &&
  a.renderHeight === b.renderHeight &&
  a.apart === b.apart;

/** True when the targets hold a display colour of its own, which the resolve reconstructs into. */
export const displayApart = (gpu: WebgpuPagesRuntime['gpu']) =>
  !!gpu.displayTexture && gpu.displayTexture !== gpu.colorTexture;

/**
 * Draws this image at `scale` in the targets in place, made at the controller's scale up to the
 * next eighth (`frameSizeOf`): the image is drawn in their top-left `targetSize`. Where the display
 * colour is not apart, the targets' whole size. The Hi-Z pyramid is built over it
 * (`GpuHiz.extent`); the last image's, of another size, no longer describes this one, as after a
 * moved view. `rt.scale.drawn` reads the scale back; `steered`, an image the controller measures;
 * `still`, a still one (`ScaleControl.drew`).
 */
export function drawFrameAt(rt: WebgpuPagesRuntime, scale: number, steered = false, still = false) {
  const { gpu } = rt,
    { allocatedSize, displaySize, targetSize } = gpu,
    apart = displayApart(gpu);
  const axis = (i: number) =>
    apart ? Math.min(allocatedSize[i], renderExtent(displaySize[i], scale)) : allocatedSize[i];
  const width = axis(0),
    height = axis(1);
  if (width !== targetSize[0] || height !== targetSize[1]) rt.run.noOccluderHistory = true;
  targetSize[0] = width;
  targetSize[1] = height;
  rt.vis.gpuHiz?.extent(width, height);
  rt.scale.drew(apart ? Math.min(scale, rt.scale.bounds.max) : 1, apart && steered, still);
}
