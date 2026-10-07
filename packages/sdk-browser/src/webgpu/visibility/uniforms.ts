import { uniformStride } from '../../residency/pools.ts'
import { viewProj } from '../pages/helpers.ts'
import { slotCount } from '../../gpu/draw/draw.ts'
import { computeSpanFor } from '../../diagnostic/gpuGeometry.ts'
import { computeRasterReady } from '../pages/render/encodeVisSetup.ts'
import type { WebgpuVisState } from '../pages/state/vis.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { DEPTH_RAMP_WORD, SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts'
import { writeDepthRamp } from '../../camera/depthConvention.ts'
import { renderMipBias, renderPixelRatio } from '../pages/state/renderScale.ts'
import { SHADE_MODE } from '../../visibility/shader/shadeMode.ts'

/** One entry per indirect draw slot, plus the direct path's. Size follows the scene's coplanar-layer
 *  count: with no layer, one layer's `BASE_SLOTS`. */
export const visUniformSlots = (vis: WebgpuVisState) => slotCount(vis.drawLayerSlots) + 1

/** Highest coplanar layer an indirect slot names. The slot count is `1 + min(deepest layer,
 *  MAX_DEPTH_LAYER)` and falls back to 1 on any failure: it never goes below 1, so the top never goes
 *  below 0. */
export const visLayerTop = (vis: WebgpuVisState) => vis.drawLayerSlots - 1

/** Uploads visibility and material resolve uniforms for the current cut, creating the two uniform
 *  buffers on `rt.vis` the first time. */
export function writeWebgpuVisibilityUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  tableRows: number,
) {
  const { vis, run } = rt,
    slots = visUniformSlots(vis),
    stride = uniformStride(device.limits),
    slotWords = stride / 4
  if (vis.visUniPacked.length !== slots * slotWords)
    vis.visUniPacked = new Float32Array(slots * slotWords)
  const { visUniPacked, shadeUniPacked } = vis,
    [width, height] = rt.gpu.targetSize,
    { diagnostic } = run,
    maskOffset = run.gpuSelection?.maskOffset ?? 0,
    pixelRatio = renderPixelRatio(rt),
    mipBias = renderMipBias(rt)
  const visUniform = (vis.visUniform ??= device.createBuffer({
    size: slots * stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
  const visInts = new Uint32Array(visUniPacked.buffer)
  const computeSpan = computeRasterReady(rt) ? computeSpanFor(rt.context?.diagnosticGpuVariant) : 0
  for (let slot = 0; slot < slots; slot++) {
    const base = slot * slotWords
    visUniPacked.set(viewProj, base)
    visUniPacked[base + 16] = width
    visUniPacked[base + 17] = height
    // Split of the cut between the two rasters, read by both: zero while the compute raster does not
    // exist, and hardware then reads not one extra vertex.
    visUniPacked[base + 18] = computeSpan
    // The compute raster splits the page row over two dispatch dimensions; it needs the live count.
    visInts[base + 19] = tableRows
    visInts[base + 20] = Math.max(0, slot - 1)
    visInts[base + 21] = slot === 0 ? 0 : 1
    visInts[base + 22] = maskOffset
    visInts[base + 23] = run.gpuSelection ? 1 : 0
    // Render pixels per CSS pixel: a line page's width counts CSS pixels (`lineClip`).
    visUniPacked[base + 24] = pixelRatio
    // Texture level offset of a frame drawn below the display (`tilePoolWgsl`).
    visUniPacked[base + 25] = mipBias
  }
  device.queue.writeBuffer(visUniform, 0, visUniPacked)
  const shadeUniform = (vis.shadeUniform ??= device.createBuffer({
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
  shadeUniPacked.set(viewProj, 0)
  shadeUniPacked[16] = width
  shadeUniPacked[17] = height
  shadeUniPacked[18] = pixelRatio
  shadeUniPacked[19] = mipBias
  const shadeInts = new Uint32Array(shadeUniPacked.buffer)
  shadeInts[20] = tableRows
  // Texture image-feedback phase: one pixel in sixteen speaks, all of them during a convergence.
  shadeInts[22] = vis.textures?.feedback.phaseWord(run.textureConverging) ?? 0
  // The depth material's ramp: white at the near plane, black at the far one.
  const { near, far, perspective } = run.gate.cam
  writeDepthRamp(shadeUniPacked, DEPTH_RAMP_WORD, near, far, perspective)
  shadeInts[21] = SHADE_MODE[diagnostic] ?? 0
  device.queue.writeBuffer(shadeUniform, 0, shadeUniPacked)
}
