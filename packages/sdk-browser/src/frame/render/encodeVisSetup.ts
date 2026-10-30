import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import type { HizWorkSource } from '../../visibility/hiz/gpu/workDepthSource.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { surfaceColorAttachments } from '../prepare/attachments.ts'
import { createGpuRaster } from '../../visibility/raster/raster.ts'
import {
  tessellationAsked,
  tessellationInput,
  tessellationWanted,
} from '../../visibility/tessellation/wanted.ts'
import { ensureWebgpuVisibilityBindings } from '../../visibility/passes/bindings.ts'
import { encodeHardwareRaster } from '../../visibility/passes/drawer.ts'
import { ensureWebgpuShadeBindings } from '../../gpu/bind/shadeBindings.ts'
import { writeWebgpuVisibilityUniforms } from '../../visibility/passes/uniforms.ts'
import { binningSteps, writeBinOptions } from '../../visibility/passes/binning.ts'
import { RASTER_PASS_MAIN, RASTER_PASS_POST } from '../../visibility/raster/contract.ts'
import { skyLightSubmitted } from './encodeSkyLight.ts'
import { submitColorCopy, withRenderEncoder } from './encoder.ts'
import { encodeSurfaceLighting } from './surfaceLighting.ts'
import type { GpuRasterInput } from '../../visibility/raster/types.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { prepared } from '../backend/state/prepared.ts'
import { noiseViewOn } from '../../gpu/noise/blueNoiseTextures.ts'
import {
  EMPTY_SURFACES_PASS,
  VISIBILITY_PRIMARY_PASS,
  VISIBILITY_SECONDARY_PASS,
} from '../../diagnostic/stage/passLabels.ts'

const emptyDepth: GPURenderPassDepthStencilAttachment = {
  view: undefined as never,
  depthClearValue: DEPTH_CLEAR,
  depthLoadOp: 'clear',
  depthStoreOp: 'store',
}
/** The clear of an image with no opaque page, held: its attachments are the image's. */
const EMPTY: GPURenderPassDescriptor = {
  label: EMPTY_SURFACES_PASS,
  colorAttachments: [],
  depthStencilAttachment: emptyDepth,
}

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
  withRenderEncoder(rt, device, (encoder) => {
    emptyDepth.view = depthTarget
    EMPTY.colorAttachments = surfaceColorAttachments(gpu.surfaces!)
    encoder.beginRenderPass(EMPTY).end()
    const presented = encodeSurfaceLighting(rt, device, encoder, cam)
    submitColorCopy(rt, device, encoder, height, width, presented)
  })
  // A captured scene that is due is drawn between this image and the next.
  skyLightSubmitted(rt)
  return run.blendSubmittedTriangles
}

/**
 * What an image gives the raster, held from one image to the next: each of its fields is
 * rewritten before every encode, and encode consumes it before returning. Writing it in the clear
 * every image allocated an eighteen-field object per image.
 */
const rasterInput = {} as GpuRasterInput

/** What the rasters read to evaluate a graph, beside the geometry: the image's frame and the blue noise
 *  (`../../visibility/shader/graphFrameWgsl.ts`), and the surfaces' records, sent up with the
 *  visibility groups (`ensureWebgpuVisibilityBindings`) before any pass. */
function graphInput(input: GpuRasterInput, vis: WebgpuPagesRuntime['vis'], device: GPUDevice) {
  input.frame = vis.graphFrame.bufferOn(device)
  input.noise = noiseViewOn(device)
  input.material = vis.materialTable.view!
}

/**
 * Creates the visibility raster — its buffer and the software raster —, made again when the targets
 * grow past it or a graph joined the session (`../prepare/lateGraphs.ts`); its lists follow the
 * room of the cut's list of visible clusters (`./visibleTables.ts`). A frame's entry makes it, its
 * pipelines compiled off the thread while the frame is held (`../loop/framePipelines.ts`); the
 * image's encode finds it.
 */
export function ensureGpuRaster(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt
  const [width, height] = rt.gpu.allocatedSize,
    capacity = rt.run.gpuSelection?.visibleCap ?? 1
  let raster = vis.gpuRaster
  if (
    !raster ||
    raster.width !== width ||
    raster.height !== height ||
    raster.rasters !== vis.rasters
  ) {
    raster?.dispose()
    raster = vis.gpuRaster = createGpuRaster(
      device,
      width,
      height,
      capacity,
      vis.rasters,
      !!rt.setup.clipping,
    )
  }
  // The displaced surfaces' tessellation, held only while the image draws one (`tessellationWanted`).
  raster.followTessellation(device, tessellationWanted(rt) ? tessellationAsked(rt) : undefined)
}

/** Writes the image's uniforms and rebuilds the shade and raster bind groups a resource change voided. */
export function ensureVisBindings(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  tableRows: number,
) {
  writeWebgpuVisibilityUniforms(rt, device, cam, tableRows)
  writeBinOptions(rt)
  ensureWebgpuShadeBindings(rt, device)
  ensureWebgpuVisibilityBindings(rt)
}

/** The three stages of the image's visibility raster over the `input` the main pass's binning
 *  encoded (`visibilityRasterStages`). */
function rasterStages(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  raster: NonNullable<WebgpuPagesRuntime['vis']['gpuRaster']>,
  input: GpuRasterInput,
  size: WebgpuPagesRuntime['gpu']['targetSize'],
) {
  const { run } = rt
  const depthSource = {} as HizWorkSource
  return {
    occluders(encoder: GPUCommandEncoder, steps: ComputeRun) {
      encodeHardwareRaster(rt, device, encoder, VISIBILITY_PRIMARY_PASS, false)
      run.gpuComputeDispatches += raster.encodeDepth(steps, RASTER_PASS_MAIN)
    },
    rest(encoder: GPUCommandEncoder, steps: ComputeRun) {
      // Called once the cut's post pass returned: its clusters are in the list. Their decode and
      // binning.
      run.gpuComputeDispatches += raster.encodeBinning(
        encoder,
        input,
        RASTER_PASS_POST,
        binningSteps(rt, RASTER_PASS_POST),
      )
      encodeHardwareRaster(rt, device, encoder, VISIBILITY_SECONDARY_PASS, true)
      run.gpuComputeDispatches += raster.encodeDepth(steps, RASTER_PASS_POST)
    },
    /** The depth so far, exported into the pyramid's level zero, for the primed pyramid's build,
     *  which reads it there. */
    exportDepth(steps: ComputeRun) {
      run.gpuComputeDispatches += raster.exportDepth(steps, input)
    },
    /** What the image's own build of the pyramid reads of the buffer (`GpuHiz.encodeFromWork`), read
     *  as the pass encodes. */
    get depthSource() {
      depthSource.work = raster.work
      depthSource.uniform = input.uniform
      depthSource.hardwareDepth = raster.wide ? undefined : input.depthView
      return depthSource
    },
    close(encoder: GPUCommandEncoder, post: boolean) {
      run.gpuComputeDispatches += raster.encodeClose(encoder, input, size, post)
      // The scene's depth, written by a full-screen triangle (`../../visibility/raster/export.ts`).
      run.gpuDrawCalls += 1
    },
  }
}

/**
 * The visibility raster of this image, the main pass's binning encoded, and its three stages ready
 * to interleave with the cut's two passes (`../../visibility/passes/passes.ts`): each runs the
 * hardware raster's slots, then the software raster's clusters, into the one visibility buffer
 * (`visWriteWgsl`) —
 * - `occluders`: the main pass's depth, the clusters the cut listed before its post pass;
 * - `rest`: once the cut's post pass listed its own, their decode and binning, their depth;
 *   the pyramid's builds read the buffer (`depthSource`) and write level zero as they go;
 * - `close(post)`: on a device without the 64-bit atomic maximum, the software identifiers of
 *   everything drawn — the post pass's too when `post` —, once every depth is down; then the
 *   export of the buffer into the identifiers and the scene's depth.
 * None when a resource the raster reads is missing: the image is then not drawn. `primed` is the
 * primed depth's draw: no tessellation, and the displaced surfaces' clusters left out, as the cut
 * left them.
 */
export function visibilityRasterStages(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  primed = false,
) {
  const { vis, gpu, run } = rt
  const raster = vis.gpuRaster,
    { concatPos, concatUv, concatNrm, pageTable, textures, mapsSampler } = vis
  if (
    !raster ||
    !gpu.cache ||
    !gpu.depthView ||
    !vis.visView ||
    !vis.shadeBins ||
    !concatPos ||
    !concatUv ||
    !concatNrm ||
    !pageTable ||
    !textures ||
    !mapsSampler
  )
    return null
  const gpuHiz = prepared(vis, 'gpuHiz')
  const input = rasterInput
  input.indices = gpu.cache.buffer
  input.positions = concatPos
  input.pages = pageTable
  // The uniform is written before any pass (`ensureVisBindings`): it exists when we encode.
  input.uniform = vis.visUniform!
  input.uvs = concatUv
  input.normals = concatNrm
  input.textures = textures
  input.sampler = mapsSampler
  graphInput(input, vis, device)
  input.idsView = vis.visView
  input.classBins = vis.shadeBins.head
  input.depthView = gpu.depthView
  input.hizView = gpuHiz.level0View
  input.tessellation = primed ? undefined : tessellationInput(rt, textures, gpu.targetSize)
  run.gpuComputeDispatches += raster.encodeBinning(
    encoder,
    input,
    RASTER_PASS_MAIN,
    binningSteps(rt, RASTER_PASS_MAIN),
  )
  return rasterStages(rt, device, raster, input, gpu.targetSize)
}
export type VisibilityRasterStages = NonNullable<ReturnType<typeof visibilityRasterStages>>
