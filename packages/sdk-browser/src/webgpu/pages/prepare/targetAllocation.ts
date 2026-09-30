import { wantsSubsurface, subsurfaceBytes, SUBSURFACE_BYTES } from '../../../scene/subsurface.ts';
import { reflectionPlan } from '../../../reflections/gpu.ts';
import { reflectionConeAllocation } from '../../../reflections/conePyramid.ts';
import { REFLECTION_HISTORY_BYTES_PER_PIXEL } from '../../../reflections/historyTargets.ts';
import { REFLECTION_RESOLVE_VIEW_BYTES } from '../../../reflections/resolveWgsl.ts';
import { REFLECTION_SOURCE_BYTES_PER_PIXEL } from '../../../reflections/source.ts';
import { REFLECTION_SOURCE_VIEW_BYTES } from '../../../reflections/sourceWgsl.ts';
import { checkSurfaceSize, frameTargetBytes } from '../../../scene/surfaceBuffer.ts';
import { AS_IS_SHARE_BYTES } from '../../../lighting/deferred/asIsShare.ts';
import { wantsAsIsShare } from './asIsShareTarget.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { FrameSize } from '../state/renderScale.ts';

/** Bytes per pixel of the display colour (`DISPLAY_FORMAT`). */
const DISPLAY_BYTES = 4;

/** Proposed image targets, passed to the existing global memory admission before allocation.
 * Device dimensions remain hard limits; streamable pools retain their coverage/tail minima.
 * Other live allocations are reserved by targetFunding through the device ledger. */
export function frameTargetAllocation(rt: WebgpuPagesRuntime, size: FrameSize, additional = 0) {
  const { reserveHiz } = rt.setup,
    gpuDevice = rt.gpu.device,
    { renderWidth: width, renderHeight: height } = size,
    display = size.apart ? size.width * size.height : 0;
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
  const plan = reflectionPlan(rt);
  checkSurfaceSize(gpuDevice, size.width, size.height, 1);
  return (
    frameTargetBytes(width, height, reserveHiz) -
    (rt.feedbackAB?.target === false ? width * height * 4 : 0) +
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
    (plan.rough
      ? width * height * REFLECTION_HISTORY_BYTES_PER_PIXEL + REFLECTION_RESOLVE_VIEW_BYTES
      : 0) +
    display * DISPLAY_BYTES +
    80
  );
}
