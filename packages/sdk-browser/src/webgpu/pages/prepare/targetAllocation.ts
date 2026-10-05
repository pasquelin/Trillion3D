import { wantsSubsurface, subsurfaceBytes, SUBSURFACE_BYTES } from '../../../scene/subsurface.ts';
import { reflectionPlan, REFLECTION_VIEW_BYTES } from '../../../reflections/gpu.ts';
import { reflectionConeAllocation } from '../../../reflections/conePyramid.ts';
import { reflectionHistoryBytes } from '../../../reflections/historyTargets.ts';
import { REFLECTION_RESOLVE_VIEW_BYTES } from '../../../reflections/resolveWgsl.ts';
import { REFLECTION_SOURCE_BYTES_PER_PIXEL } from '../../../reflections/source.ts';
import { REFLECTION_SOURCE_VIEW_BYTES } from '../../../reflections/sourceWgsl.ts';
import {
  checkSurfaceSize,
  emissiveAoBytes,
  FEEDBACK_BYTES,
  frameTargetBytes,
} from '../../../scene/surfaceBuffer.ts';
import { AS_IS_SHARE_BYTES } from '../../../lighting/deferred/asIsShare.ts';
import { wantsAsIsShare } from './asIsShareTarget.ts';
import { backdropBytes } from '../../transparent/transmission.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { FrameSize } from '../state/renderScale.ts';

/** Bytes per pixel of the display colour (`DISPLAY_FORMAT`). */
const DISPLAY_BYTES = 4;

/**
 * Whether a frame of `size` makes a display colour of its own at the render size (`Trillion3D
 * display color`): drawn at the display's size, it is the display. Apart, the composition writes
 * the display and nothing visible reads that colour but the water's word, which borrows it: a
 * scene without water makes none, and one drawn at the display's size borrows the display itself
 * (`buildTargets`).
 */
export const ownsDisplayColor = (rt: WebgpuPagesRuntime, size: FrameSize) =>
  !size.apart ||
  (rt.blendState.transmissive > 0 &&
    (size.renderWidth !== size.width || size.renderHeight !== size.height));

/** Proposed image targets, passed to the existing global memory admission before allocation.
 * Device dimensions remain hard limits; streamable pools retain their coverage/tail minima.
 * Other live allocations are reserved by targetFunding through the device ledger. */
export function frameTargetAllocation(rt: WebgpuPagesRuntime, size: FrameSize, additional = 0) {
  // The view's Hi-Z pyramid, while it has one (`prepareVisibility`, dropped when refused).
  const hiz = !!rt.vis?.gpuHiz,
    gpuDevice = rt.gpu.device,
    { renderWidth: width, renderHeight: height } = size,
    display = size.apart ? size.width * size.height : 0;
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
  const plan = reflectionPlan(rt);
  checkSurfaceSize(gpuDevice, size.width, size.height, 1);
  return (
    frameTargetBytes(width, height, hiz) -
    (ownsDisplayColor(rt, size) ? 0 : width * height * DISPLAY_BYTES) -
    // The feedback target, only while the pipelines write it (`feedbackVariant.ts`).
    (rt.vis.writesFeedback ? 0 : width * height * FEEDBACK_BYTES) +
    // The emission-and-occlusion layer, or its 1×1 stand-in (`emissiveAoLayer.ts`).
    emissiveAoBytes(width, height, rt.vis.writesEmissiveAo) -
    emissiveAoBytes(width, height, true) +
    (wantsAsIsShare(rt) ? width * height * AS_IS_SHARE_BYTES : 0) +
    additional +
    // frameTargetBytes already counts the 1×1 placeholder.
    subsurfaceBytes(width, height, wantsSubsurface(rt)) -
    SUBSURFACE_BYTES +
    (plan.pyramid
      ? reflectionConeAllocation(width, height, gpuDevice.limits, plan.cone).bytes
      : 0) +
    // The reprojected source (8 bytes a pixel) and what it is reprojected from (`source.ts`).
    (plan.active
      ? width * height * (8 + REFLECTION_SOURCE_BYTES_PER_PIXEL) + REFLECTION_SOURCE_VIEW_BYTES
      : 8) +
    (plan.rough ? reflectionHistoryBytes(width, height) + REFLECTION_RESOLVE_VIEW_BYTES : 0) +
    display * DISPLAY_BYTES +
    REFLECTION_VIEW_BYTES
  );
}

/** What a frame of `size` asks of the budget beside its targets (`frameTargetAllocation`'s
 *  `additional`, `requestFrameTargets`): the capture's reserve while one is under way, and the
 *  transmission's backdrop at the render size. */
export const frameExtraBytes = (rt: WebgpuPagesRuntime, size: FrameSize) =>
  (rt.capture.surfaceCapture ? 0 : rt.capture.captureAllocationBytes) +
  backdropBytes(rt, size.renderWidth, size.renderHeight);
