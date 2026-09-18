import { checkSurfaceSize, createSurfaceBuffer, frameTargetBytes } from './surfaceBuffer.ts';
import { dropGpuHiz } from './webgpuPagesDrops.ts';
import { backdropBytes, createBackdrop, disposeBackdrop } from './webgpuTransmission.ts';
import { ensureTaaTargets } from './taaPrepare.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export function checkFrameBudget(
  rt: WebgpuPagesRuntime,
  width: number,
  height: number,
  additional = 0,
) {
  const { gpuDevice, frameBudget, reserveHiz } = rt.setup;
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE');
  checkSurfaceSize(gpuDevice, width, height, frameBudget, 1);
  const bytes = frameTargetBytes(width, height, reserveHiz) + additional;
  if (bytes > frameBudget) throw new Error(`SURFACE_BUDGET: ${bytes} > ${frameBudget}`);
  return bytes;
}

/** Allocates the frame targets for a size, and nothing when the current ones already fit it. */
export function ensureTargets(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  width: number,
  height: number,
) {
  const { gpu, vis, run, capture, diag, blendState } = rt,
    { frameBudget, reserveHiz } = rt.setup;
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
    budgetBytes: frameBudget,
    hiZReserved: reserveHiz,
  }));
  const targetBytes = checkFrameBudget(
    rt,
    width,
    height,
    capture.captureAllocationBytes + backdropBytes(rt, width, height),
  );
  gpu.colorTexture?.destroy();
  gpu.depthTexture?.destroy();
  vis.visTexture?.destroy();
  gpu.hdrTexture?.destroy();
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
  gpu.surfaces = createSurfaceBuffer(
    device,
    width,
    height,
    frameBudget - capture.captureAllocationBytes,
  );
  gpu.colorView = gpu.colorTexture.createView();
  gpu.depthView = gpu.depthTexture.createView();
  gpu.hdrView = gpu.hdrTexture.createView();
  gpu.backdrop = createBackdrop(device, width, height, blendState.transmissive > 0);
  // L'historique temporel suit la taille de l'image, dans ce qui reste du budget.
  const allocationBytes = targetBytes + ensureTaaTargets(rt, width, height, targetBytes);
  gpu.targetBytes = allocationBytes;
  // Les groupes de liaison d'un item transparent nomment les vues du fond : elles viennent de
  // changer, donc ils sont refaits à la première image qui suit.
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
    budgetBytes: frameBudget,
    physicalVramBytes: null,
    surfaceVersion: 1,
  };
  diag.traceDiagnostic(
    'targets-transition',
    'Cibles GPU allouées après transition',
    () => allocation,
  );
  diag.engineDiagnostic('frame-allocation', 'Cibles GPU allouées', allocation);
}
