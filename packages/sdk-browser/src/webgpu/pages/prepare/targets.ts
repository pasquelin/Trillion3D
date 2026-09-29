import { createScreenReflection, wantsReflections } from '../../../reflections/gpu.ts';
import {
  DISPLAY_FORMAT,
  FEEDBACK_FORMAT,
  checkSurfaceSize,
  createSurfaceBuffer,
  frameTargetBytes,
} from '../../../scene/surfaceBuffer.ts';
import { dropGpuHiz } from '../io/drops.ts';
import { createBackdrop, disposeBackdrop } from '../../transparent/transmission.ts';
import { ensureTaaTargets } from '../../../taa/prepare.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { MATERIAL_DEPTH_FORMAT } from '../../../visibility/shader/materialClass.ts';
import { MATERIAL_DEPTH_PASS } from '../../core/materialPasses.ts';
import { AS_IS_SHARE_BYTES, createAsIsShare } from '../../../lighting/deferred/asIsShare.ts';
import { displayApart, type FrameSize } from '../state/renderScale.ts';

/** Bytes per pixel of the display colour (`DISPLAY_FORMAT`). */
const DISPLAY_BYTES = 4;

/**
 * Bytes of the image targets at this size: those drawn at the render size, and the display colour
 * composition writes when it is not the render one. As in the reference, targets follow
 * resolution: no byte ceiling refuses an image, only a size the device cannot make is, by name.
 * What the image costs is published (`gpuFrameTargetBytes`), and the engine's fixed budgets bear on
 * what streams — geometry pages, texture tiles.
 */
export function frameTargetAllocation(rt: WebgpuPagesRuntime, size: FrameSize, additional = 0) {
  const { reserveHiz } = rt.setup,
    gpuDevice = rt.gpu.device,
    { renderWidth: width, renderHeight: height } = size,
    display = size.apart ? size.width * size.height : 0;
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
  checkSurfaceSize(gpuDevice, size.width, size.height, 1);
  return (
    frameTargetBytes(width, height, reserveHiz) -
    (rt.feedbackAB?.target === false ? width * height * 4 : 0) +
    width * height * AS_IS_SHARE_BYTES +
    additional +
    (wantsReflections(rt) ? width * height * 8 : 8) +
    display * DISPLAY_BYTES +
    80
  );
}

/** True when the drawn view's frame targets in place are those of `size`, both sizes alike. */
export function targetsFit(rt: WebgpuPagesRuntime, size: FrameSize) {
  const { gpu, vis } = rt;
  return (
    !!gpu.colorTexture &&
    gpu.allocatedSize[0] === size.renderWidth &&
    gpu.allocatedSize[1] === size.renderHeight &&
    gpu.displaySize[0] === size.width &&
    gpu.displaySize[1] === size.height &&
    displayApart(gpu) === size.apart &&
    !!gpu.surfaces &&
    !!gpu.feedbackTexture === (rt.feedbackAB?.target !== false) &&
    gpu.reflection?.active === wantsReflections(rt) &&
    (!vis.visEnabled || !!vis.visTexture)
  );
}

/** Releases the frame targets in place: none is drawn into or presented until the next are made.
 *  The view's temporal history goes with them: a capture draws in a view of its own. */
export function releaseTargets(rt: WebgpuPagesRuntime) {
  const { gpu, vis, capture } = rt;
  const textures = [gpu.colorTexture, gpu.depthTexture, gpu.hdrTexture, gpu.feedbackTexture];
  if (gpu.displayTexture !== gpu.colorTexture) textures.push(gpu.displayTexture);
  for (const texture of [...textures, vis.visTexture, vis.materialDepthTexture]) texture?.destroy();
  gpu.colorTexture = gpu.depthTexture = gpu.hdrTexture = gpu.feedbackTexture = undefined;
  gpu.colorView = gpu.depthView = gpu.hdrView = gpu.feedbackView = undefined;
  gpu.displayTexture = gpu.displayView = undefined;
  gpu.targetBytes = 0;
  vis.visTexture = vis.materialDepthTexture = undefined;
  vis.visView = vis.materialDepthView = undefined;
  disposeBackdrop(gpu);
  gpu.reflection?.dispose();
  gpu.reflection = undefined;
  gpu.surfaces?.dispose();
  gpu.surfaces = undefined;
  gpu.asIsShare?.dispose();
  gpu.asIsShare = undefined;
  gpu.displayFilter?.dispose();
  gpu.displayFilter = undefined;
  vis.gpuRaster?.dispose();
  vis.gpuRaster = undefined;
  capture.capturedPixels = undefined;
  capture.capturedRevision = -1;
  gpu.temporal?.release();
}

/** The texture-feedback target; only the A/B diagnostic copies it out. */
export function makeFeedbackTarget(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  rt.gpu.feedbackTexture = device.createTexture({
    label: 'Trillion3D texture feedback target',
    size: { width, height },
    format: FEEDBACK_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      (rt.context.feedbackTargetAB ? GPUTextureUsage.COPY_SRC : 0),
  });
  rt.gpu.feedbackView = rt.gpu.feedbackTexture.createView();
}

/**
 * Makes the frame targets of `size`, of `targetBytes` before the history: what `targetGrant.ts`
 * runs under the device's out-of-memory check, the targets in place released first. Every pass
 * up to the temporal resolve draws at the render size, the targets' or below it; the history and
 * the display colour are the display's. Returns what releases them again, and what they cost
 * (`frame-allocation`).
 */
export function makeTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  size: FrameSize,
  targetBytes: number,
) {
  const { gpu, vis, run, capture, blendState } = rt,
    { renderWidth: width, renderHeight: height } = size;
  releaseTargets(rt);
  const sampled = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    usage = sampled | GPUTextureUsage.COPY_SRC;
  const target = (
    label: string,
    format: GPUTextureFormat,
    targetUsage = usage,
    extent: GPUExtent3DDict = { width, height },
  ) => device.createTexture({ label, size: extent, format, usage: targetUsage });
  gpu.colorTexture = target('Trillion3D display color', DISPLAY_FORMAT);
  gpu.depthTexture = target(
    'Trillion3D opaque depth',
    'depth32float',
    usage | GPUTextureUsage.COPY_DST,
  );
  gpu.hdrTexture = target('Trillion3D HDR lighting', 'rgba16float');
  if (rt.feedbackAB?.target !== false) makeFeedbackTarget(rt, device, width, height);
  gpu.surfaces = createSurfaceBuffer(device, width, height);
  gpu.asIsShare = createAsIsShare(device, gpu.surfaces.views()[3], width, height);
  gpu.colorView = gpu.colorTexture.createView();
  gpu.displayTexture = size.apart
    ? target('Trillion3D display', DISPLAY_FORMAT, usage, {
        width: size.width,
        height: size.height,
      })
    : gpu.colorTexture;
  gpu.displayView = size.apart ? gpu.displayTexture.createView() : gpu.colorView;
  gpu.depthView = gpu.depthTexture.createView();
  gpu.hdrView = gpu.hdrTexture.createView();
  gpu.reflection = createScreenReflection(
    device,
    width,
    height,
    gpu.depthView,
    wantsReflections(rt),
  );
  gpu.backdrop = createBackdrop(device, width, height, blendState.transmissive > 0);
  // Temporal history follows the display size.
  const allocationBytes = targetBytes + ensureTaaTargets(rt, size.width, size.height);
  gpu.targetBytes = allocationBytes;
  gpu.allocatedSize = [width, height];
  // Drawn at the targets' whole size until an image's entry says its scale (`drawFrameAt`).
  gpu.targetSize = [width, height];
  gpu.displaySize = [size.width, size.height];
  // Visibility targets too: one the device cannot make refuses the set, the mode kept.
  vis.visTexture = target('Trillion3D visibility', 'r32uint', sampled);
  vis.visView = vis.visTexture.createView();
  // Each pixel's material class, as the depth every class pass tests against.
  vis.materialDepthTexture = target(
    MATERIAL_DEPTH_PASS,
    MATERIAL_DEPTH_FORMAT,
    GPUTextureUsage.RENDER_ATTACHMENT,
  );
  vis.materialDepthView = vis.materialDepthTexture.createView();
  if (vis.gpuHiz && !vis.gpuHiz.resize(device, width, height)) dropGpuHiz(rt);
  const allocation = {
    frame: run.frame,
    width,
    height,
    allocationBytes,
    captureAllocationBytes: capture.captureAllocationBytes,
    physicalVramBytes: null,
    surfaceVersion: 1,
  };
  return { allocation, destroy: () => releaseTargets(rt) };
}
