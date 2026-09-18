import type { EngineCamera } from './cameraWorld.ts';
import { surfaceColorAttachments } from './webgpuPagesAttachments.ts';
import { createGpuRaster } from './gpuRaster.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { writeWebgpuVisibilityUniforms } from './webgpuVisibilityUniforms.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { requestsComputeRaster } from './diagnosticGpuGeometry.ts';
import { createRenderEncoder, submitColorCopy } from './webgpuPagesEncoder.ts';
import { encodeSurfaceLighting } from './webgpuPagesEncodeBlend.ts';
import type { GpuRasterInput } from './gpuRasterTypes.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';

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
 * Crée le raster de calcul une fois, et seulement sous une variante qui le demande — `raster-calcul`
 * ou `raster-hybride` : en production le matériel dessine (Géométrie 26). Une variante est une demande, pas une occasion — un appareil
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
 * Le raster de calcul dessine cette image : il existe, et toutes ses ressources aussi. C'est LA
 * décision que l'uniforme du partage (`computeSpan`) et les étapes encodées lisent toutes les deux ;
 * une seule, sinon le matériel replierait des triangles que personne ne dessine.
 */
export function computeRasterReady(rt: WebgpuPagesRuntime) {
  const { vis, gpu } = rt;
  const raster = vis.gpuRaster,
    { concatPos, concatUv, pageTable, zeroFlags, textures, mapsSampler } = vis;
  if (
    !raster ||
    !gpu.cache ||
    !concatPos ||
    !concatUv ||
    !pageTable ||
    !zeroFlags ||
    !textures ||
    !mapsSampler
  )
    return null;
  return {
    raster,
    indices: gpu.cache.buffer,
    concatPos,
    concatUv,
    pageTable,
    zeroFlags,
    textures,
    mapsSampler,
  };
}

/**
 * Les trois étapes du raster de calcul, prêtes à s'intercaler entre les passes du raster matériel :
 * la moitié occulteurs après la passe primaire, la moitié testée après la secondaire, les
 * identifiants pour clore — chacune fondue dans les attachements que le matériel a posés.
 */
export function computeRasterStages(
  rt: WebgpuPagesRuntime,
  twoPass: boolean,
  tableRows: number,
  maxVertexCount: number,
  idsView: GPUTextureView,
  depthTarget: GPUTextureView,
) {
  const { vis, run } = rt;
  const ready = computeRasterReady(rt);
  if (!ready) return null;
  const { raster } = ready;
  // Le partage occulteurs/testés voyage par le mot de verdict que la partition a écrit : sans
  // partition, ou sans pyramide, l'image lit des zéros et rastère toute la coupe en une fois.
  const hizFlags = twoPass && vis.gpuHiz ? vis.gpuHiz.flags : ready.zeroFlags;
  const key = (hizFlags === ready.zeroFlags ? 0 : 1) + (run.gpuFrameActive ? 2 : 0);
  const input = rasterInput;
  input.indices = ready.indices;
  input.positions = ready.concatPos;
  input.pages = ready.pageTable;
  input.hizFlags = hizFlags;
  // L'uniforme est écrit avant toute passe (`ensureVisBindings`) : il existe quand on encode.
  input.uniform = vis.visUniform!;
  input.uvs = ready.concatUv;
  input.textures = ready.textures;
  input.sampler = ready.mapsSampler;
  input.pageRows = tableRows;
  input.maxTriangles = Math.ceil(maxVertexCount / 3);
  input.idsView = idsView;
  input.depthView = depthTarget;
  input.hizView = vis.gpuHiz?.level0View;
  input.tested = twoPass && !!vis.gpuHiz;
  input.selection = run.gpuFrameActive ? run.gpuSelection : undefined;
  input.groups = vis.rasterGroups;
  input.groupKey = key;
  // Les triangles plein écran des résolutions sont des appels de dessin comme les autres : celui
  // qui clôt l'image, et celui de la pyramide quand la moitié testée existe. Le compte les porte.
  return {
    occluders(encoder: GPUCommandEncoder) {
      run.gpuDrawCalls += input.tested ? 1 : 0;
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
