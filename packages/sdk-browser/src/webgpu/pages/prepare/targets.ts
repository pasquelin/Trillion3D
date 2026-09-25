import {
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

/**
 * Bytes of the image targets at this size. As in the reference, targets follow resolution: no byte
 * ceiling refuses an image, only a size the device cannot make is, by name. What the image costs is
 * published (`gpuFrameTargetBytes`), and the engine's fixed budgets bear on what streams — geometry
 * pages, texture tiles.
 */
export function frameTargetAllocation(
  rt: WebgpuPagesRuntime,
  width: number,
  height: number,
  additional = 0,
) {
  const { reserveHiz } = rt.setup,
    gpuDevice = rt.gpu.device;
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
  checkSurfaceSize(gpuDevice, width, height, 1);
  return frameTargetBytes(width, height, reserveHiz) + additional;
}

/** True when the frame targets in place are those of `width × height`. */
export function targetsFit(rt: WebgpuPagesRuntime, width: number, height: number) {
  const { gpu, vis } = rt;
  return (
    !!gpu.colorTexture &&
    gpu.targetSize[0] === width &&
    gpu.targetSize[1] === height &&
    !!gpu.surfaces &&
    (!vis.visEnabled || !!vis.visTexture) &&
    (!vis.gpuHiz || (vis.gpuHiz.width === width && vis.gpuHiz.height === height))
  );
}

/** Releases the frame targets in place: none is drawn into or presented until the next are made.
 *  The view's history goes with them, never under a capture, which leaves it whole. */
export function releaseTargets(rt: WebgpuPagesRuntime) {
  const { gpu, vis, capture } = rt;
  for (const texture of [
    gpu.colorTexture,
    gpu.depthTexture,
    gpu.hdrTexture,
    gpu.feedbackTexture,
    vis.visTexture,
    vis.materialDepthTexture,
  ])
    texture?.destroy();
  gpu.colorTexture = gpu.depthTexture = gpu.hdrTexture = gpu.feedbackTexture = undefined;
  gpu.colorView = gpu.depthView = gpu.hdrView = gpu.feedbackView = undefined;
  gpu.targetBytes = 0;
  vis.visTexture = vis.materialDepthTexture = undefined;
  vis.visView = vis.materialDepthView = undefined;
  disposeBackdrop(gpu);
  gpu.surfaces?.dispose();
  gpu.surfaces = undefined;
  vis.gpuRaster?.dispose();
  vis.gpuRaster = undefined;
  capture.capturedPixels = undefined;
  capture.capturedRevision = -1;
  if (!capture.capturing) gpu.temporal?.release();
}

/**
 * Makes the frame targets of `width × height`, of `targetBytes` before the history: what
 * `targetGrant.ts` runs under the device's out-of-memory check, the targets in place released
 * first. Returns what releases them again, and what they cost (`frame-allocation`).
 */
export function makeTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
  targetBytes: number,
) {
  const { gpu, vis, run, capture, blendState } = rt;
  releaseTargets(rt);
  const sampled = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    usage = sampled | GPUTextureUsage.COPY_SRC;
  const target = (label: string, format: GPUTextureFormat, targetUsage = usage) =>
    device.createTexture({ label, size: { width, height }, format, usage: targetUsage });
  gpu.colorTexture = target('Trillion3D display color', 'rgba8unorm');
  gpu.depthTexture = target(
    'Trillion3D opaque depth',
    'depth32float',
    usage | GPUTextureUsage.COPY_DST,
  );
  gpu.hdrTexture = target('Trillion3D HDR lighting', 'rgba16float');
  gpu.feedbackTexture = target('Trillion3D texture feedback target', FEEDBACK_FORMAT, sampled);
  gpu.feedbackView = gpu.feedbackTexture.createView();
  gpu.surfaces = createSurfaceBuffer(device, width, height);
  gpu.colorView = gpu.colorTexture.createView();
  gpu.depthView = gpu.depthTexture.createView();
  gpu.hdrView = gpu.hdrTexture.createView();
  gpu.backdrop = createBackdrop(device, width, height, blendState.transmissive > 0);
  // Temporal history follows the image size, like the other targets.
  const allocationBytes = targetBytes + ensureTaaTargets(rt, width, height);
  gpu.targetBytes = allocationBytes;
  gpu.targetSize = [width, height];
  // The visibility targets are frame targets too: one the device cannot make refuses the set by
  // name (`targetGrant.ts`), and the mode is kept.
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
