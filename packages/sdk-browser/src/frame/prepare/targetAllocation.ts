import { wantsSubsurface, SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { PHYSICAL_LOBES_TARGET } from '../../materials/surface/physicalLobes.ts'
import { wantsPhysicalLobes } from './lobesTarget.ts'
import {
  checkSurfaceSize,
  emissiveAoBytes,
  FEEDBACK_BYTES,
  frameTargetBytes,
} from '../../materials/surface/surfaceBuffer.ts'
import { AS_IS_SHARE_BYTES } from '../../lighting/deferred/asIsShare.ts'
import { wantsAsIsShare } from './asIsShareTarget.ts'
import { backdropBytes } from '../../blend/transparent/transmission.ts'
import { reflectionBytes } from '../../lighting/reflections/gpu.ts'
import { level0LayerBytes } from '../../visibility/hiz/gpu/pyramid.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { FrameSize } from '../backend/state/renderScale.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { DISPLAY_FORMAT } from '../../scene/targetFormats.ts'

/** Bytes per pixel of the display colour. */
const DISPLAY_BYTES = texelBytesOf(DISPLAY_FORMAT)

/**
 * Whether the scene has blends — transmissive ones included —, which the front pass draws into the transparents'
 * front layer (`createFrontLayer`'s `blends`): laid out when the session opens, none enters or leaves it
 * (`webgpuMaterialClassRefusal`). Any other scene keeps a texel of its target and nothing else, and
 * draws what it drew before.
 */
export const sceneBlends = (rt: Pick<WebgpuPagesRuntime, 'blendState'>) =>
  rt.blendState.blendGpu.length > 0 || !!rt.blendState.frontGranted

/**
 * Whether a frame of `size` makes a display colour of its own at the render size (`Trillion3D
 * display color`): drawn at the display's size, it is the display. Apart, the composition writes
 * the display and nothing reads that colour: none is made (`buildTargets`).
 */
export const makesDisplayColor = (_rt: WebgpuPagesRuntime, size: FrameSize) => !size.apart

/** Proposed image targets, passed to the existing global memory admission before allocation.
 * Device dimensions remain hard limits; streamable pools retain their coverage/tail minima.
 * Other live allocations are reserved by targetFunding through the device ledger. */
export function frameTargetAllocation(rt: WebgpuPagesRuntime, size: FrameSize, additional = 0) {
  // The view's Hi-Z pyramid, while it has one (`prepareVisibility`, dropped when refused).
  const hiz = !!rt.vis?.gpuHiz,
    gpuDevice = rt.gpu.device,
    { renderWidth: width, renderHeight: height } = size,
    display = size.apart ? size.width * size.height : 0
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE')
  checkSurfaceSize(gpuDevice, size.width, size.height, 1)
  return (
    frameTargetBytes(width, height, hiz) -
    (makesDisplayColor(rt, size) ? 0 : width * height * DISPLAY_BYTES) -
    // The feedback target, only while the pipelines write it (`feedbackVariant.ts`).
    (rt.vis.writesFeedback ? 0 : width * height * FEEDBACK_BYTES) +
    // The emission-and-occlusion layer, or its 1×1 stand-in (`emissiveAoLayer.ts`).
    emissiveAoBytes(width, height, rt.vis.writesEmissiveAo) -
    emissiveAoBytes(width, height, true) +
    (wantsAsIsShare(rt) ? width * height * AS_IS_SHARE_BYTES : 0) +
    additional +
    // frameTargetBytes already counts the 1×1 placeholder.
    SUBSURFACE_TARGET.bytes(width, height, wantsSubsurface(rt)) -
    SUBSURFACE_TARGET.texelBytes +
    // The lobes target, or its 1×1 placeholder, which frameTargetBytes counts (`physicalLobes.ts`).
    PHYSICAL_LOBES_TARGET.bytes(width, height, wantsPhysicalLobes(rt)) -
    PHYSICAL_LOBES_TARGET.texelBytes +
    // The reflection's target and radiance pyramid (`../../lighting/reflections/gpu.ts`).
    reflectionBytes(width, height, sceneBlends(rt)) +
    // The Hi-Z level 0's front layer, made with every pyramid.
    (hiz ? level0LayerBytes(width, height) : 0) +
    display * DISPLAY_BYTES
  )
}

/** What a frame of `size` asks of the budget beside its targets (`frameTargetAllocation`'s
 *  `additional`, `requestFrameTargets`): the capture's reserve while one is under way, and the
 *  distortion's targets at the render size. */
export const frameExtraBytes = (rt: WebgpuPagesRuntime, size: FrameSize) =>
  (rt.capture.surfaceCapture ? 0 : rt.capture.captureAllocationBytes) +
  backdropBytes(rt, size.renderWidth, size.renderHeight)
