import { viewProj } from './webgpuPagesHelpers.ts';
import { slotCount } from './gpuDraw.ts';
import { computeSpanFor } from './diagnosticGpuGeometry.ts';
import { computeRasterReady } from './webgpuPagesEncodeVisSetup.ts';
import type { WebgpuVisState } from './webgpuPagesStateVis.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import { SHADE_UNIFORM_BYTES, writeSunSlice } from './visibilityShaderRequest.ts';

/** Une entrée par slot de dessin indirect, plus celle du chemin direct. La taille suit le nombre de
 *  couches coplanaires de la scène : sans couche, c'est exactement le tampon d'avant. */
export const visUniformSlots = (vis: WebgpuVisState) => slotCount(vis.drawLayerSlots) + 1;

/** La couche coplanaire la plus haute qu'un slot indirect nomme. Le nombre de slots vaut `1 + min(
 *  couche la plus profonde, MAX_DEPTH_LAYER)` et retombe à 1 sur toute défaillance : il ne descend
 *  jamais sous 1, et le sommet ne descend donc jamais sous 0. */
export const visLayerTop = (vis: WebgpuVisState) => vis.drawLayerSlots - 1;

/** Uploads visibility and material resolve uniforms for the current cut, creating the two uniform
 *  buffers on `rt.vis` the first time. */
export function writeWebgpuVisibilityUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  tableRows: number,
) {
  const { vis, run } = rt,
    slots = visUniformSlots(vis);
  if (vis.visUniPacked.length !== slots * 64) vis.visUniPacked = new Float32Array(slots * 64);
  const { visUniPacked, shadeUniPacked } = vis,
    [width, height] = rt.gpu.targetSize,
    { gpuFrameActive, diagnostic } = run,
    maskOffset = run.gpuSelection?.maskOffset ?? 0;
  const visUniform = (vis.visUniform ??= device.createBuffer({
    size: slots * 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }));
  const visInts = new Uint32Array(visUniPacked.buffer);
  const computeSpan = computeRasterReady(rt) ? computeSpanFor(rt.context?.diagnosticGpuVariant) : 0;
  for (let slot = 0; slot < slots; slot++) {
    const base = slot * 64;
    visUniPacked.set(viewProj, base);
    visUniPacked[base + 16] = width;
    visUniPacked[base + 17] = height;
    // Le partage de la coupe entre les deux rasters, lu par les deux : zéro tant que le raster de
    // calcul n'existe pas, et le matériel ne lit alors pas un sommet de plus.
    visUniPacked[base + 18] = computeSpan;
    // The compute raster splits the page row over two dispatch dimensions; it needs the live count.
    visInts[base + 19] = tableRows;
    visInts[base + 20] = Math.max(0, slot - 1);
    visInts[base + 21] = slot === 0 ? 0 : 1;
    visInts[base + 22] = gpuFrameActive ? maskOffset : 0;
    visInts[base + 23] = gpuFrameActive ? 1 : 0;
  }
  device.queue.writeBuffer(visUniform, 0, visUniPacked);
  const shadeUniform = (vis.shadeUniform ??= device.createBuffer({
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }));
  shadeUniPacked.set(viewProj, 0);
  shadeUniPacked[16] = width;
  shadeUniPacked[17] = height;
  const shadeInts = new Uint32Array(shadeUniPacked.buffer);
  shadeInts[20] = tableRows;
  // La phase du retour d'image des textures : un pixel sur seize parle, tous pendant une convergence.
  shadeInts[22] = vis.textures?.feedback.phaseWord(run.textureConverging) ?? 0;
  // La tranche d'ombre du soleil, pour que la résolution demande les tuiles que l'ombre d'un
  // feuillage lit ; sans soleil à ombre, une tranche sans face, et rien n'est demandé.
  writeSunSlice(rt.lights, shadeUniPacked);
  shadeInts[21] =
    diagnostic === 'beauty'
      ? 0
      : diagnostic === 'wireframe'
        ? 1
        : diagnostic === 'clusters'
          ? 2
          : diagnostic === 'pages'
            ? 3
            : diagnostic === 'lod'
              ? 4
              : diagnostic === 'visibility'
                ? 5
                : 6;
  device.queue.writeBuffer(shadeUniform, 0, shadeUniPacked);
}
