import type { EngineCamera } from '../../../camera/world.ts';
import { surfaceColorAttachments } from '../prepare/attachments.ts';
import { createGpuRaster } from '../../../gpu/raster/raster.ts';
import { ensureWebgpuVisibilityBindings } from '../../visibility/bindings.ts';
import { ensureWebgpuShadeBindings } from '../../core/shadeBindings.ts';
import { writeWebgpuVisibilityUniforms } from '../../visibility/uniforms.ts';
import { requestsComputeRaster } from '../../../diagnostic/gpuGeometry.ts';
import { createRenderEncoder, submitColorCopy } from './encoder.ts';
import { encodeSurfaceLighting } from './encodeBlend.ts';
import type { GpuRasterInput } from '../../../gpu/raster/types.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { DEPTH_CLEAR } from '../../../camera/depthConvention.ts';

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
 * What an image gives the compute raster, held from one image to the next: each of its fields is
 * rewritten before every encode, and encode consumes it before returning. Writing it in the clear
 * every image allocated an eighteen-field object per image.
 */
const rasterInput = {} as GpuRasterInput;

/**
 * Creates the compute raster once, and only under a variant that asks for it — `raster-calcul` or
 * `raster-hybride`: in production the hardware draws (Geometry 26). A variant is a request, not an
 * opportunity — a device without compute or an exceeded surface budget refuses; they do not silently
 * render the hardware image under the compute label.
 */
export function ensureGpuRaster(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt;
  if (vis.gpuRaster || !requestsComputeRaster(rt.context?.diagnosticGpuVariant)) return;
  if (typeof device.createComputePipeline !== 'function')
    throw new Error('COMPUTE_RASTER_UNAVAILABLE: raster-calcul requested without a compute stage');
  const [width, height] = rt.gpu.targetSize;
  vis.gpuRaster = createGpuRaster(device, width, height, rt.layout.rasterCapacity);
}

/** Writes the image's uniforms and rebuilds the shade and raster bind groups a resource change voided. */
export function ensureVisBindings(rt: WebgpuPagesRuntime, device: GPUDevice, tableRows: number) {
  writeWebgpuVisibilityUniforms(rt, device, tableRows);
  ensureWebgpuShadeBindings(rt, device);
  ensureWebgpuVisibilityBindings(rt, device);
}

/**
 * The compute raster draws this image: it exists, and so do all its resources. That is THE decision
 * the split uniform (`computeSpan`) and the encoded stages both read; one only, or hardware would
 * fold triangles nobody draws.
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
 * The three compute-raster stages, ready to interleave between the hardware raster's passes:
 * occluder half after the primary pass, tested half after the secondary, identifiers to close —
 * each blended into the attachments hardware posted.
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
  // The occluder/tested split travels in the verdict word the partition wrote: without a partition,
  // or without a pyramid, the image reads zeros and rasters the whole cut in one go.
  const hizFlags = twoPass && vis.gpuHiz ? vis.gpuHiz.flags : ready.zeroFlags;
  const key = (hizFlags === ready.zeroFlags ? 0 : 1) + (run.gpuFrameActive ? 2 : 0);
  const input = rasterInput;
  input.indices = ready.indices;
  input.positions = ready.concatPos;
  input.pages = ready.pageTable;
  input.hizFlags = hizFlags;
  // The uniform is written before any pass (`ensureVisBindings`): it exists when we encode.
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
  // Full-screen resolve triangles are draw calls like the others: the one that closes the image,
  // and the pyramid's when the tested half exists. The count carries them.
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
