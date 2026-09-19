import {
  FEEDBACK_FORMAT,
  checkSurfaceSize,
  createSurfaceBuffer,
  frameTargetBytes,
} from './surfaceBuffer.ts';
import { dropGpuHiz } from './webgpuPagesDrops.ts';
import { backdropBytes, createBackdrop, disposeBackdrop } from './webgpuTransmission.ts';
import { ensureTaaTargets } from './taaPrepare.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

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
  const { gpuDevice, reserveHiz } = rt.setup;
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
  checkSurfaceSize(gpuDevice, width, height, 1);
  return frameTargetBytes(width, height, reserveHiz) + additional;
}

/** Allocates the frame targets for a size, and nothing when the current ones already fit it. */
export function ensureTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  const { gpu, vis, run, capture, diag, blendState } = rt,
    { reserveHiz } = rt.setup;
  if (
    gpu.colorTexture &&
    gpu.targetSize[0] === width &&
    gpu.targetSize[1] === height &&
    gpu.surfaces &&
    (!vis.visEnabled || vis.visTexture) &&
    (!vis.gpuHiz || (vis.gpuHiz.width === width && vis.gpuHiz.height === height))
  )
    return;
  diag.traceDiagnostic('targets-request', 'Demande de cibles GPU pour la frame', () => ({
    frame: run.frame,
    width,
    height,
    previousSize: gpu.targetSize.slice(),
    additionalBytes: capture.captureAllocationBytes,
    hiZReserved: reserveHiz,
  }));
  const targetBytes = frameTargetAllocation(
    rt,
    width,
    height,
    capture.captureAllocationBytes + backdropBytes(rt, width, height),
  );
  gpu.colorTexture?.destroy();
  gpu.depthTexture?.destroy();
  vis.visTexture?.destroy();
  gpu.hdrTexture?.destroy();
  gpu.feedbackTexture?.destroy();
  disposeBackdrop(gpu);
  gpu.surfaces?.dispose();
  vis.visTexture = undefined;
  vis.visView = undefined;
  vis.shadeBindGroup = undefined;
  vis.visBindGroup = undefined;
  vis.visHizBindGroup = undefined;
  vis.gpuRaster?.dispose();
  vis.gpuRaster = undefined;
  capture.capturedPixels = undefined;
  capture.capturedRevision = -1;
  const usage =
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
  gpu.colorTexture = device.createTexture({
    label: 'WG display color',
    size: { width, height },
    format: 'rgba8unorm',
    usage,
  });
  gpu.depthTexture = device.createTexture({
    label: 'WG opaque depth',
    size: { width, height },
    format: 'depth32float',
    usage: usage | GPUTextureUsage.COPY_DST,
  });
  gpu.hdrTexture = device.createTexture({
    label: 'WG HDR lighting',
    size: { width, height },
    format: 'rgba16float',
    usage,
  });
  gpu.feedbackTexture = device.createTexture({
    label: 'WG texture feedback target',
    size: { width, height },
    format: FEEDBACK_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  gpu.feedbackView = gpu.feedbackTexture.createView();
  gpu.surfaces = createSurfaceBuffer(device, width, height);
  gpu.colorView = gpu.colorTexture.createView();
  gpu.depthView = gpu.depthTexture.createView();
  gpu.hdrView = gpu.hdrTexture.createView();
  gpu.backdrop = createBackdrop(device, width, height, blendState.transmissive > 0);
  // Temporal history follows the image size, like the other targets.
  const allocationBytes = targetBytes + ensureTaaTargets(rt, width, height);
  gpu.targetBytes = allocationBytes;
  // Bind groups of a transparent item name the backdrop views: they have just changed, so they are
  // rebuilt at the first image that follows.
  for (const item of blendState.blendGpu) item.group = undefined;
  blendState.pagedGroup = undefined;
  gpu.targetSize = [width, height];
  try {
    vis.visTexture = device.createTexture({
      label: 'WG visibility',
      size: { width, height },
      format: 'r32uint',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    vis.visView = vis.visTexture.createView();
  } catch (error) {
    diag.diagnosticFailure('visibility-target-failed', error);
  }
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
  diag.traceDiagnostic(
    'targets-transition',
    'GPU targets allocated after transition',
    () => allocation,
  );
  diag.engineDiagnostic('frame-allocation', 'GPU targets allocated', allocation);
}
