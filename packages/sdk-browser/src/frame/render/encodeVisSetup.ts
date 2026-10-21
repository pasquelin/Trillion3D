import type { EngineCamera } from '../../camera/engineCamera.ts'
import { surfaceColorAttachments } from '../prepare/attachments.ts'
import { createGpuRaster } from '../../visibility/raster/raster.ts'
import { ensureWebgpuVisibilityBindings } from '../../visibility/passes/bindings.ts'
import { encodeHardwareRaster } from '../../visibility/passes/drawer.ts'
import { ensureWebgpuShadeBindings } from '../../gpu/bind/shadeBindings.ts'
import { visPostEntry, writeWebgpuVisibilityUniforms } from '../../visibility/passes/uniforms.ts'
import { RASTER_PASS_MAIN, RASTER_PASS_POST } from '../../visibility/raster/contract.ts'
import { uniformStride } from '../../session/memory/pools.ts'
import { createRenderEncoder, submitColorCopy } from './encoder.ts'
import { encodeSurfaceLighting } from './surfaceLighting.ts'
import type { GpuRasterInput } from '../../visibility/raster/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { prepared } from '../backend/state/prepared.ts'
import {
  EMPTY_SURFACES_PASS,
  VISIBILITY_IDENTIFIERS_PASS,
  VISIBILITY_PRIMARY_PASS,
  VISIBILITY_SECONDARY_PASS,
} from '../../diagnostic/stage/passLabels.ts'

/** An image with no drawable row still clears the surfaces, lights them and presents the result. */
export function encodeEmptySurfaces(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  depthTarget: GPUTextureView,
) {
  const { gpu, run } = rt
  const [width, height] = gpu.targetSize
  if (!gpu.surfaces) throw new Error('SURFACE_UNAVAILABLE')
  const encoder = createRenderEncoder(rt, device)
  const pass = encoder.beginRenderPass({
    label: EMPTY_SURFACES_PASS,
    colorAttachments: surfaceColorAttachments(gpu.surfaces),
    depthStencilAttachment: {
      view: depthTarget,
      depthClearValue: DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  })
  pass.end()
  const presented = encodeSurfaceLighting(rt, device, encoder, cam)
  submitColorCopy(rt, device, encoder, height, width, presented)
  return run.blendSubmittedTriangles
}

/**
 * What an image gives the raster, held from one image to the next: each of its fields is
 * rewritten before every encode, and encode consumes it before returning. Writing it in the clear
 * every image allocated an eighteen-field object per image.
 */
const rasterInput = {} as GpuRasterInput

/**
 * Creates the visibility raster — its buffer, the cluster split and the software classes —, made
 * again when the targets grow past it or the row table outgrows its lists. A frame's entry makes
 * it, its pipelines compiled off the thread while the frame is held (`../loop/framePipelines.ts`);
 * the image's encode finds it.
 */
export function ensureGpuRaster(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt
  const [width, height] = rt.gpu.allocatedSize,
    capacity = rt.layout.rasterCapacity
  const held = vis.gpuRaster
  if (held && held.width === width && held.height === height && held.capacity === capacity) return
  held?.dispose()
  vis.gpuRaster = createGpuRaster(device, width, height, capacity)
}

/** Writes the image's uniforms and rebuilds the shade and raster bind groups a resource change voided. */
export function ensureVisBindings(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  tableRows: number,
) {
  writeWebgpuVisibilityUniforms(rt, device, cam, tableRows)
  // The resolve's cache is laid for this image's rows before its group names the buffer.
  const [width, height] = rt.gpu.targetSize
  rt.vis.shadeCache?.layFor(tableRows, rt.setup.maxCorners, width, height)
  ensureWebgpuShadeBindings(rt, device)
  ensureWebgpuVisibilityBindings(rt)
}

/** The hardware slots a pass draws: the main pass's half, the post pass's, or both. */
const MAIN_HALF = [false] as const,
  POST_HALF = [true] as const,
  BOTH_HALVES = [false, true] as const

/**
 * The visibility raster of this image, the main pass's binning encoded, and its three stages ready
 * to interleave with the cut's two passes (`../../visibility/passes/passes.ts`): each runs the
 * hardware raster's slots, then the software raster's lists, into the one visibility buffer
 * (`VIS_WRITE_WGSL`) —
 * - `occluders`: the main pass's depth, the rows the frame mask holds before the post pass, then
 *   the pyramid's level zero from it;
 * - `rest`: once the cut's post pass wrote its mask, its rows' binning and hardware compaction,
 *   their depth, then level zero again from the whole depth;
 * - `ids(post)`: the identifiers of everything drawn — the post pass's too when `post` —, once
 *   every depth is down, then the resolve into the attachments.
 * None when a resource the raster reads is missing: the image is then not drawn.
 */
export function visibilityRasterStages(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { vis, gpu, run } = rt
  const raster = vis.gpuRaster,
    { concatPos, concatUv, concatNrm, pageTable, textures, mapsSampler } = vis
  if (
    !raster ||
    !gpu.cache ||
    !gpu.depthView ||
    !vis.visView ||
    !concatPos ||
    !concatUv ||
    !concatNrm ||
    !pageTable ||
    !textures ||
    !mapsSampler
  )
    return null
  const gpuHiz = prepared(vis, 'gpuHiz'),
    gpuDraw = prepared(vis, 'gpuDraw')
  const input = rasterInput
  input.indices = gpu.cache.buffer
  input.positions = concatPos
  input.pages = pageTable
  // The uniform is written before any pass (`ensureVisBindings`): it exists when we encode. The
  // post pass's binning reads its own entry, whose selection is the post mask.
  input.uniform = vis.visUniform!
  input.postUniformOffset = visPostEntry(vis) * uniformStride(device.limits)
  input.uvs = concatUv
  input.normals = concatNrm
  input.textures = textures
  input.sampler = mapsSampler
  // Sent up with the visibility groups (`ensureWebgpuVisibilityBindings`), before any pass.
  input.material = vis.materialTable.view!
  input.items = gpuDraw.itemsBuffer
  input.pageRows = rt.layout.rows.packedCount
  input.idsView = vis.visView
  input.depthView = gpu.depthView
  input.hizView = gpuHiz.level0View
  input.selection = run.gpuSelection
  run.gpuComputeDispatches += raster.encodeBinning(encoder, input, RASTER_PASS_MAIN)
  const size = gpu.targetSize
  // Full-screen resolve triangles are draw calls like the others: the pyramid's level zero after
  // each pass's depth and the one that closes the image. The count carries them.
  const depthLevel = (encoder: GPUCommandEncoder) => {
    raster.encodeDepthLevel(encoder, input, size)
    run.gpuDrawCalls += 1
  }
  return {
    occluders(encoder: GPUCommandEncoder) {
      encodeHardwareRaster(rt, device, encoder, VISIBILITY_PRIMARY_PASS, MAIN_HALF, false)
      run.gpuComputeDispatches += raster.encodeDepth(encoder, RASTER_PASS_MAIN)
      depthLevel(encoder)
    },
    rest(encoder: GPUCommandEncoder) {
      // Called once the cut's post pass returned: the selection exists and its post mask is
      // written. Its rows' split and binning, then their hardware compaction, in one compute pass.
      const { postMaskOffset } = run.gpuSelection!
      run.gpuComputeDispatches += raster.encodeBinning(encoder, input, RASTER_PASS_POST, (open) =>
        gpuDraw.encodePost(open, postMaskOffset),
      )
      encodeHardwareRaster(rt, device, encoder, VISIBILITY_SECONDARY_PASS, POST_HALF, false)
      run.gpuComputeDispatches += raster.encodeDepth(encoder, RASTER_PASS_POST)
      depthLevel(encoder)
    },
    ids(encoder: GPUCommandEncoder, post: boolean) {
      const halves = post ? BOTH_HALVES : MAIN_HALF
      encodeHardwareRaster(rt, device, encoder, VISIBILITY_IDENTIFIERS_PASS, halves, true)
      run.gpuComputeDispatches += raster.encodeIds(encoder, input, size, post)
      run.gpuDrawCalls += 1
    },
  }
}
export type VisibilityRasterStages = NonNullable<ReturnType<typeof visibilityRasterStages>>
