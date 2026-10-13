import { visUniformLayout } from '../core/bindLayout.ts'
import { viewProj } from '../pages/helpers.ts'
import { slotCount } from '../../gpu/draw/draw.ts'
import { computeSpanFor } from '../../diagnostic/gpuGeometry.ts'
import { computeRasterReady } from '../pages/render/encodeVisSetup.ts'
import type { WebgpuVisState } from '../pages/state/vis.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { SHADE_UNIFORM_BYTES } from '../../visibility/shader/request.ts'
import { SHADE_UNIFORM, VIS_UNIFORM } from '../../visibility/shader/uniformLayout.ts'
import { writeDepthRamp } from '../../camera/depthConvention.ts'
import { renderMipBias, renderPixelRatio } from '../pages/state/renderScale.ts'
import { SHADE_MODE } from '../../visibility/shader/shadeMode.ts'

/** One entry per indirect draw slot, plus the direct path's. Size follows the scene's coplanar-layer
 *  count: with no layer, one layer's `BASE_SLOTS`. */
export const visUniformSlots = (vis: Pick<WebgpuVisState, 'drawLayerSlots'>) =>
  slotCount(vis.drawLayerSlots) + 1

/** Highest coplanar layer an indirect slot names. The slot count is `1 + min(deepest layer,
 *  MAX_DEPTH_LAYER)` and falls back to 1 on any failure: it never goes below 1, so the top never goes
 *  below 0. */
export const visLayerTop = (vis: WebgpuVisState) => vis.drawLayerSlots - 1

const U = VIS_UNIFORM.at,
  SHADE = SHADE_UNIFORM.at
/** The integer view of a packed array, made once: an image makes none. */
const ints = new WeakMap<Float32Array, Uint32Array>()
const intsOf = (words: Float32Array) => {
  let view = ints.get(words)
  if (!view) ints.set(words, (view = new Uint32Array(words.buffer)))
  return view
}
/** The words every slot holds alike, built each image and compared with what slot 0 holds. */
const shared = new Float32Array(VIS_UNIFORM.words),
  sharedInts = intsOf(shared)

/** Uploads visibility and material resolve uniforms for the current cut, creating the two uniform
 *  buffers on `rt.vis` the first time. A slot differs from the next by its two words alone
 *  (`drawSlot`, `indirect`), fixed by its number: they are written when the slots are made, the
 *  rest is built once, copied to every slot, and uploaded only when it changed. */
export function writeWebgpuVisibilityUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  tableRows: number,
) {
  const { vis, run } = rt,
    slots = visUniformSlots(vis),
    layout = visUniformLayout(device.limits, slots),
    slotWords = layout.strideWords
  const made = vis.visUniPacked.length !== slots * slotWords || !vis.visUniform
  if (vis.visUniPacked.length !== slots * slotWords)
    vis.visUniPacked = new Float32Array(slots * slotWords)
  const { visUniPacked, shadeUniPacked } = vis,
    [width, height] = rt.gpu.targetSize,
    { diagnostic } = run,
    maskOffset = run.gpuSelection?.maskOffset ?? 0,
    pixelRatio = renderPixelRatio(rt),
    mipBias = renderMipBias(rt)
  const visUniform = (vis.visUniform ??= device.createBuffer({
    size: layout.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
  const visInts = intsOf(visUniPacked)
  const computeSpan = computeRasterReady(rt) ? computeSpanFor(rt.context?.diagnosticGpuVariant) : 0
  shared.fill(0)
  shared.set(viewProj, U.viewProj)
  shared[U.viewport] = width
  shared[U.viewport + 1] = height
  // Split of the cut between the two rasters, read by both: zero while the compute raster does not
  // exist, and hardware then reads not one extra vertex.
  shared[U.computeSpan] = computeSpan
  // The compute raster splits the page row over two dispatch dimensions; it needs the live count.
  sharedInts[U.pageCount] = tableRows
  sharedInts[U.selectionOffset] = maskOffset
  sharedInts[U.selectionEnabled] = run.gpuSelection ? 1 : 0
  // Render pixels per CSS pixel: a line page's width counts CSS pixels (`lineClip`).
  shared[U.pixelRatio] = pixelRatio
  // Texture level offset of a frame drawn below the display (`tilePoolWgsl`).
  shared[U.mipBias] = mipBias
  let changed = made
  for (let word = 0; word < shared.length; word++) {
    if (word === U.drawSlot || word === U.indirect) continue
    if (visInts[word] !== sharedInts[word]) {
      changed = true
      break
    }
  }
  if (changed) {
    for (let slot = 0; slot < slots; slot++) {
      const base = slot * slotWords
      for (let word = 0; word < shared.length; word++)
        if (word !== U.drawSlot && word !== U.indirect) visInts[base + word] = sharedInts[word]
      if (made) {
        visInts[base + U.drawSlot] = Math.max(0, slot - 1)
        visInts[base + U.indirect] = slot === 0 ? 0 : 1
      }
    }
    device.queue.writeBuffer(visUniform, 0, visUniPacked)
  }
  const shadeUniform = (vis.shadeUniform ??= device.createBuffer({
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
  shadeUniPacked.set(viewProj, SHADE.viewProj)
  shadeUniPacked[SHADE.viewport] = width
  shadeUniPacked[SHADE.viewport + 1] = height
  shadeUniPacked[SHADE.pixelRatio] = pixelRatio
  shadeUniPacked[SHADE.mipBias] = mipBias
  const shadeInts = intsOf(shadeUniPacked)
  shadeInts[SHADE.pageCount] = tableRows
  // Texture image-feedback phase: one pixel in sixteen speaks, all of them during a convergence.
  shadeInts[SHADE.feedback] = vis.textures?.feedback.phaseWord(run.textureConverging) ?? 0
  // The depth material's ramp: white at the near plane, black at the far one.
  const { near, far, perspective } = run.gate.cam
  writeDepthRamp(shadeUniPacked, SHADE.depthRamp, near, far, perspective)
  shadeInts[SHADE.mode] = SHADE_MODE[diagnostic] ?? 0
  device.queue.writeBuffer(shadeUniform, 0, shadeUniPacked)
}
