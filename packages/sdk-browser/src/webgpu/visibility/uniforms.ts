import { viewProj } from '../pages/helpers.ts';
import { slotCount } from '../../gpu/draw/draw.ts';
import { computeSpanFor } from '../../diagnostic/gpuGeometry.ts';
import { computeRasterReady } from '../pages/render/encodeVisSetup.ts';
import type { WebgpuVisState } from '../pages/state/vis.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { SHADE_UNIFORM_BYTES, writeSunSlice } from '../../visibility/shader/request.ts';
import { pixelScaleOf } from '../../camera/pixelFootprint.ts';
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';

/** `uni.mode` of the resolve, per diagnostic view (`../../visibility/shader/shadeWgsl.ts`); beauty is zero. */
const SHADE_MODE: Partial<Record<DiagnosticMode, number>> = {
  wireframe: 1,
  clusters: 2,
  pages: 3,
  lod: 4,
  visibility: 5,
  'screen-error': 6,
  materials: 7,
};

/** One entry per indirect draw slot, plus the direct path's. Size follows the scene's coplanar-layer
 *  count: with no layer, it is exactly the previous buffer. */
export const visUniformSlots = (vis: WebgpuVisState) => slotCount(vis.drawLayerSlots) + 1;

/** Highest coplanar layer an indirect slot names. The slot count is `1 + min(deepest layer,
 *  MAX_DEPTH_LAYER)` and falls back to 1 on any failure: it never goes below 1, so the top never goes
 *  below 0. */
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
    // Split of the cut between the two rasters, read by both: zero while the compute raster does not
    // exist, and hardware then reads not one extra vertex.
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
  // Texture image-feedback phase: one pixel in sixteen speaks, all of them during a convergence.
  shadeInts[22] = vis.textures?.feedback.phaseWord(run.textureConverging) ?? 0;
  // The sun's clipmap, and the pixel scale that picks its level, so resolve asks for the tiles a
  // foliage shadow reads; with no sun to shadow, a header of zeros, and nothing is asked.
  shadeUniPacked[23] = run.lastCamera ? pixelScaleOf(run.gate.cam.projection, height) : 0;
  writeSunSlice(rt.lights, shadeUniPacked);
  shadeInts[21] = SHADE_MODE[diagnostic] ?? 0;
  device.queue.writeBuffer(shadeUniform, 0, shadeUniPacked);
}
