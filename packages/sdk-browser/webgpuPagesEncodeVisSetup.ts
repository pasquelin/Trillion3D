import type { EngineCamera } from './cameraWorld.ts';
import { createGpuSmallTriangles } from './gpuSmallTriangles.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { writeWebgpuVisibilityUniforms } from './webgpuVisibilityUniforms.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { createRenderEncoder, submitColorCopy } from './webgpuPagesEncoder.ts';
import { encodeSurfaceLighting } from './webgpuPagesEncodeBlend.ts';
import type { SurfaceBuffer } from './surfaceBuffer.ts';
import { grantCapability } from './webgpuPagesDrops.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';

let attachmentsFor: GPUTextureView[] | undefined,
  attachments: GPURenderPassColorAttachment[] | undefined;

/**
 * Les pièces jointes de couleur des surfaces, gardées telles quelles jusqu'au prochain jeu de vues.
 * Leurs quatre descripteurs ne dépendent que des vues, et les vues ne changent qu'au redimensionnement
 * de la cible : les reconstruire par image allouait cinq objets pour écrire les mêmes champs.
 * `views()` reste appelé à chaque image, c'est lui qui refuse une cible libérée.
 */
export function surfaceColorAttachments(surfaces: SurfaceBuffer) {
  const views = surfaces.views();
  if (attachmentsFor !== views || !attachments) {
    attachments = views.map((view) => ({
      view,
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    }));
    attachmentsFor = views;
  }
  return attachments;
}

/** An image with no drawable row still clears the surfaces, lights them and presents the result. */
export function encodeEmptySurfaces(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  depthTarget: GPUTextureView,
) {
  const { gpu, run } = rt;
  const [width, height] = gpu.targetSize;
  if (!gpu.surfaces) throw new Error('SURFACE_UNAVAILABLE');
  const encoder = createRenderEncoder(rt, device);
  const pass = encoder.beginRenderPass({
    label: 'WG empty surfaces',
    colorAttachments: surfaceColorAttachments(gpu.surfaces),
    depthStencilAttachment: {
      view: depthTarget,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.end();
  const presented = encodeSurfaceLighting(rt, device, encoder, cam, 0);
  submitColorCopy(rt, device, encoder, height, width, presented);
  return run.blendSubmittedTriangles;
}

/** Creates the small-triangle compute raster once, and remembers when the device cannot host it. */
export function ensureGpuSmall(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, capture, capabilities, diag } = rt,
    [width, height] = rt.gpu.targetSize;
  if (vis.gpuSmall || vis.hybridUnavailable || typeof device.createComputePipeline !== 'function')
    return;
  try {
    checkFrameBudget(
      rt,
      width,
      height,
      capture.captureAllocationBytes + width * height * 8 + rt.layout.smallTriangleCapacity * 4,
    );
    vis.gpuSmall = createGpuSmallTriangles(device, width, height, rt.layout.smallTriangleCapacity);
    grantCapability(capabilities, 'small-triangle compute raster');
  } catch (error) {
    vis.hybridUnavailable = true;
    diag.diagnosticFailure('small-triangle-compute-unavailable', error);
  }
}

/** Writes the image's uniforms and rebuilds the shade and raster bind groups a resource change voided. */
export function ensureVisBindings(rt: WebgpuPagesRuntime, device: GPUDevice, tableRows: number) {
  writeWebgpuVisibilityUniforms(rt, device, tableRows);
  ensureWebgpuShadeBindings(rt, device);
  ensureWebgpuVisibilityBindings(rt, device);
}

/** Rasterises the small triangles the raster passes skipped, when the compute path is available. */
export function encodeSmallTriangles(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  twoPass: boolean,
  tableRows: number,
  maxVertexCount: number,
  idsView: GPUTextureView,
  depthTarget: GPUTextureView,
) {
  const { vis, gpu, run } = rt;
  if (
    !vis.gpuSmall ||
    !gpu.cache ||
    !vis.concatPos ||
    !vis.concatUv ||
    !vis.pageTable ||
    !vis.visUniform ||
    !vis.zeroFlags ||
    !vis.colorAtlas ||
    !vis.slots ||
    !vis.mapsSampler
  )
    return;
  // Every row carries its own Hi-Z slot, so a frame that ran no occlusion test is handed the zero
  // flags: the pyramid verdicts of the previous image do not describe this one.
  const hizFlags = twoPass && vis.gpuHiz ? vis.gpuHiz.flags : vis.zeroFlags;
  const smallKey = (hizFlags === vis.zeroFlags ? 0 : 1) + (run.gpuFrameActive ? 2 : 0);
  vis.gpuSmall.encode(encoder, {
    indices: gpu.cache.buffer,
    positions: vis.concatPos,
    pages: vis.pageTable,
    hizFlags,
    uniform: vis.visUniform,
    uvs: vis.concatUv,
    colorAtlas: vis.colorAtlas,
    slots: vis.slots,
    sampler: vis.mapsSampler,
    pageRows: tableRows,
    maxTriangles: Math.ceil(maxVertexCount / 3),
    idsView: idsView,
    depthView: depthTarget,
    hizView: vis.gpuHiz?.level0View,
    selection: run.gpuFrameActive ? run.gpuSelection : undefined,
    groups: vis.smallGroups,
    groupKey: smallKey,
  });
  run.gpuDrawCalls++;
}
