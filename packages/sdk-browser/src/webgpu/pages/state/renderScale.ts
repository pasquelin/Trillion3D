import { upscaleMipBias } from '../../../taa/jitter.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Smallest render scale: half the display per axis, the reference's minimum screen percentage. */
export const MIN_RENDER_SCALE = 0.5;

/** The session's render scale from the host's: in `[MIN_RENDER_SCALE, 1]`, 1 when absent or not a
 *  number. A fixed internal value in this step; its controller and public setting are #832. */
export const sessionRenderScale = (asked: number | undefined) =>
  asked === undefined || !(asked < 1) ? 1 : Math.max(MIN_RENDER_SCALE, asked);

/** One display axis drawn at `scale`: the axis itself at 1, otherwise a multiple of eight, so a
 *  scale never lands on an odd size. */
export const renderExtent = (display: number, scale: number) =>
  scale >= 1 ? display : Math.min(display, Math.max(8, Math.round((scale * display) / 8) * 8));

/**
 * The scale the drawn view's frame is drawn at. Below one only where the temporal resolve
 * reconstructs the display: its pass rigged and wanted, in the beauty view, on the visibility
 * buffer. A capture — drawn in a view of its own, which holds no pass —, a diagnostic view, which
 * renders at the pixel centre, and the fallback draw stay at the display's size.
 */
export function renderScaleOf(rt: WebgpuPagesRuntime) {
  const { gpu, run, vis } = rt;
  const reconstructed =
    !!gpu.temporal && gpu.temporalWanted && run.diagnostic === 'beauty' && vis.visEnabled;
  return reconstructed ? sessionRenderScale(rt.context.renderScale) : 1;
}

/** Render pixels per CSS pixel: the host's ratio times the render-to-display one, so a line drawn
 *  below the display keeps its display width. The host's own at native size. */
export const renderPixelRatio = (rt: WebgpuPagesRuntime) =>
  rt.setup.pixelRatio() * (rt.gpu.targetSize[0] / rt.gpu.displaySize[0]);

/** Texture level offset of the frame (`upscaleMipBias`), the same for the read and the request:
 *  zero at native size. */
export const renderMipBias = (rt: WebgpuPagesRuntime) =>
  upscaleMipBias(rt.gpu.targetSize[0], rt.gpu.displaySize[0]);

/** A frame's two sizes: the display's, and the one its passes draw at up to the resolve. */
export interface FrameSize {
  width: number;
  height: number;
  renderWidth: number;
  renderHeight: number;
}

/** The drawn view's frame size, written into `into`: its viewport, and that at its render scale. */
export function frameSizeOf(rt: WebgpuPagesRuntime, into: FrameSize) {
  const scale = renderScaleOf(rt);
  into.width = Math.max(1, rt.setup.viewport[0]);
  into.height = Math.max(1, rt.setup.viewport[1]);
  into.renderWidth = renderExtent(into.width, scale);
  into.renderHeight = renderExtent(into.height, scale);
  return into;
}

/** True when the frame is drawn below the display on either axis: the display colour is a target
 *  of its own and the resolve reconstructs it. */
export const drawnBelow = (size: FrameSize) =>
  size.renderWidth !== size.width || size.renderHeight !== size.height;

/** True when `a` and `b` are the same frame size, both sizes alike. */
export const sameFrameSize = (a: FrameSize, b: FrameSize) =>
  a.width === b.width &&
  a.height === b.height &&
  a.renderWidth === b.renderWidth &&
  a.renderHeight === b.renderHeight;
