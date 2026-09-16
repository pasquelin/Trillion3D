import type { EngineCamera } from './cameraWorld.ts';
import { createGpuRaster } from './gpuRaster.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { writeWebgpuVisibilityUniforms } from './webgpuVisibilityUniforms.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { skipsSecondaryPass } from './diagnosticGpuGeometry.ts';
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

/** Crée le raster de calcul une fois, et retient l'appareil qui ne peut pas l'héberger. */
export function ensureGpuRaster(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, capture, capabilities, diag } = rt,
    [width, height] = rt.gpu.targetSize;
  if (vis.gpuRaster || vis.hybridUnavailable || typeof device.createComputePipeline !== 'function')
    return;
  try {
    checkFrameBudget(
      rt,
      width,
      height,
      capture.captureAllocationBytes + width * height * 8 + rt.layout.rasterCapacity * 8,
    );
    vis.gpuRaster = createGpuRaster(device, width, height, rt.layout.rasterCapacity);
    grantCapability(capabilities, 'opaque compute raster');
  } catch (error) {
    vis.hybridUnavailable = true;
    diag.diagnosticFailure('opaque-compute-raster-unavailable', error);
  }
}

/** Writes the image's uniforms and rebuilds the shade and raster bind groups a resource change voided. */
export function ensureVisBindings(rt: WebgpuPagesRuntime, device: GPUDevice, tableRows: number) {
  writeWebgpuVisibilityUniforms(rt, device, tableRows);
  ensureWebgpuShadeBindings(rt, device);
  ensureWebgpuVisibilityBindings(rt, device);
}

/**
 * Rastère en calcul TOUS les triangles opaques et masqués de la coupe, et rend le nombre de
 * lancements encodés. `midFrame` porte la pyramide et le test d'occultation : ils tombent entre la
 * profondeur des occulteurs et celle de la moitié testée, là où le raster matériel les mettait.
 * Rend `null` — et rien n'est encodé — quand une ressource manque : l'appelant reprend le matériel.
 */
export function encodeRaster(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  twoPass: boolean,
  tableRows: number,
  maxVertexCount: number,
  idsView: GPUTextureView,
  depthTarget: GPUTextureView,
  midFrame: (encoder: GPUCommandEncoder) => void,
) {
  const { vis, gpu, run } = rt;
  if (
    !vis.gpuRaster ||
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
    return null;
  // Le partage occulteurs/testés voyage par le mot de verdict que la partition a écrit : sans
  // partition, ou sans pyramide, l'image lit des zéros et rastère toute la coupe en une fois.
  const hizFlags = twoPass && vis.gpuHiz ? vis.gpuHiz.flags : vis.zeroFlags;
  const key = (hizFlags === vis.zeroFlags ? 0 : 1) + (run.gpuFrameActive ? 2 : 0);
  const mid = twoPass && vis.gpuHiz ? midFrame : undefined;
  // Les triangles plein écran des résolutions sont des appels de dessin comme les autres : celui
  // qui clôt l'image, et celui de la pyramide quand la moitié testée existe. Le compte les porte.
  run.gpuDrawCalls += mid ? 2 : 1;
  return vis.gpuRaster.encode(
    encoder,
    {
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
      idsView,
      depthView: depthTarget,
      hizView: vis.gpuHiz?.level0View,
      selection: run.gpuFrameActive ? run.gpuSelection : undefined,
      skipRest: skipsSecondaryPass(rt.context?.diagnosticGpuVariant),
      groups: vis.rasterGroups,
      groupKey: key,
    },
    mid,
  );
}
