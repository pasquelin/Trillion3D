import type { EngineCamera } from './cameraWorld.ts';
import { createGpuRaster } from './gpuRaster.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { writeWebgpuVisibilityUniforms } from './webgpuVisibilityUniforms.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { requestsComputeRaster } from './diagnosticGpuGeometry.ts';
import { createRenderEncoder, submitColorCopy } from './webgpuPagesEncoder.ts';
import { encodeSurfaceLighting } from './webgpuPagesEncodeBlend.ts';
import type { SurfaceBuffer } from './surfaceBuffer.ts';
import type { GpuRasterInput } from './gpuRasterTypes.ts';
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

/**
 * Ce qu'une image donne au raster de calcul, tenu d'une image à l'autre : chacun de ses champs est
 * réécrit avant chaque encodage, et l'encodage le consomme avant de rendre la main. L'écrire en
 * clair à chaque image allouait un objet de dix-huit champs par image.
 */
const rasterInput = {} as GpuRasterInput;

/**
 * Crée le raster de calcul une fois, et seulement sous la variante `raster-calcul` : en production
 * le matériel dessine (Géométrie 26). Une variante est une demande, pas une occasion — un appareil
 * sans calcul ou un budget de surfaces dépassé refuse, ils ne rendent pas en silence l'image du
 * matériel sous l'étiquette du calcul.
 */
export function ensureGpuRaster(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, capture } = rt;
  if (vis.gpuRaster || !requestsComputeRaster(rt.context?.diagnosticGpuVariant)) return;
  if (typeof device.createComputePipeline !== 'function')
    throw new Error('COMPUTE_RASTER_UNAVAILABLE: raster-calcul demandé sans étage de calcul');
  const [width, height] = rt.gpu.targetSize;
  checkFrameBudget(
    rt,
    width,
    height,
    capture.captureAllocationBytes + width * height * 8 + rt.layout.rasterCapacity * 8,
  );
  vis.gpuRaster = createGpuRaster(device, width, height, rt.layout.rasterCapacity);
}

/** Writes the image's uniforms and rebuilds the shade and raster bind groups a resource change voided. */
export function ensureVisBindings(rt: WebgpuPagesRuntime, device: GPUDevice, tableRows: number) {
  writeWebgpuVisibilityUniforms(rt, device, tableRows);
  ensureWebgpuShadeBindings(rt, device);
  ensureWebgpuVisibilityBindings(rt, device);
}

/**
 * Les trois étapes du raster de calcul, prêtes à s'intercaler entre les passes du raster matériel :
 * la moitié occulteurs après la passe primaire, la moitié testée après la secondaire, les
 * identifiants pour clore — chacune fondue dans les attachements que le matériel a posés. Rend
 * `null` quand une ressource manque : le matériel dessine alors seul, et les triangles que le
 * partage lui aurait retirés restent les siens tant que `computeSpan` vaut zéro.
 */
export function computeRasterStages(
  rt: WebgpuPagesRuntime,
  twoPass: boolean,
  tableRows: number,
  maxVertexCount: number,
  idsView: GPUTextureView,
  depthTarget: GPUTextureView,
) {
  const { vis, gpu, run } = rt;
  const raster = vis.gpuRaster;
  if (
    !raster ||
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
  const input = rasterInput;
  input.indices = gpu.cache.buffer;
  input.positions = vis.concatPos;
  input.pages = vis.pageTable;
  input.hizFlags = hizFlags;
  input.uniform = vis.visUniform;
  input.uvs = vis.concatUv;
  input.colorAtlas = vis.colorAtlas;
  input.slots = vis.slots;
  input.sampler = vis.mapsSampler;
  input.pageRows = tableRows;
  input.maxTriangles = Math.ceil(maxVertexCount / 3);
  input.idsView = idsView;
  input.depthView = depthTarget;
  input.hizView = vis.gpuHiz?.level0View;
  input.selection = run.gpuFrameActive ? run.gpuSelection : undefined;
  input.groups = vis.rasterGroups;
  input.groupKey = key;
  // Les triangles plein écran des résolutions sont des appels de dessin comme les autres : celui
  // qui clôt l'image, et celui de la pyramide quand la moitié testée existe. Le compte les porte.
  return {
    occluders(encoder: GPUCommandEncoder) {
      run.gpuDrawCalls += input.hizView ? 1 : 0;
      run.gpuComputeDispatches += raster.encodeOccluders(encoder, input);
    },
    rest(encoder: GPUCommandEncoder) {
      run.gpuComputeDispatches += raster.encodeRest(encoder);
    },
    ids(encoder: GPUCommandEncoder) {
      run.gpuDrawCalls += 1;
      run.gpuComputeDispatches += raster.encodeIds(encoder, input);
    },
  };
}
export type ComputeRasterStages = ReturnType<typeof computeRasterStages>;
