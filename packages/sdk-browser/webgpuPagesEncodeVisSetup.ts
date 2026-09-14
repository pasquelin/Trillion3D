import type * as THREE from 'three';
import { createGpuSmallTriangles } from './gpuSmallTriangles.ts';
import { ensureWebgpuVisibilityBindings } from './webgpuVisibilityBindings.ts';
import { ensureWebgpuShadeBindings } from './webgpuShadeBindings.ts';
import { writeWebgpuVisibilityUniforms } from './webgpuVisibilityUniforms.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { createRenderEncoder, submitColorCopy } from './webgpuPagesEncoder.ts';
import { encodeSurfaceLighting } from './webgpuPagesEncodeBlend.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** An image with no drawable row still clears the surfaces, lights them and presents the result. */
export function encodeEmptySurfaces(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  camera: THREE.PerspectiveCamera,
  depthTarget: GPUTextureView,
) {
  const { gpu, run } = rt;
  const [width, height] = gpu.targetSize;
  if (!gpu.surfaces) throw new Error('SURFACE_UNAVAILABLE');
  const encoder = createRenderEncoder(rt, device);
  const pass = encoder.beginRenderPass({
    label: 'WG empty surfaces',
    colorAttachments: gpu.surfaces.views().map((view) => ({
      view,
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    })),
    depthStencilAttachment: {
      view: depthTarget,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  pass.end();
  const presented = encodeSurfaceLighting(rt, device, encoder, camera, 0);
  submitColorCopy(rt, device, encoder, height, width, presented);
  return run.blendSubmittedTriangles;
}

/** Creates the small-triangle compute raster once, and remembers when the device cannot host it. */
export function ensureGpuSmall(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, capture, capabilities, diag } = rt,
    [width, height] = rt.gpu.targetSize;
  if (vis.gpuSmall || vis.hybridUnavailable || typeof device.createComputePipeline !== 'function')
    return;
  try {
    checkFrameBudget(
      rt,
      width,
      height,
      capture.captureAllocationBytes + width * height * 8 + rt.layout.smallTriangleCapacity * 4,
    );
    vis.gpuSmall = createGpuSmallTriangles(device, width, height, rt.layout.smallTriangleCapacity);
    capabilities.unsupported = capabilities.unsupported.filter(
      (item) => item !== 'small-triangle compute raster',
    );
  } catch (error) {
    vis.hybridUnavailable = true;
    diag.diagnosticFailure('small-triangle-compute-unavailable', error);
  }
}

/** Writes the image's uniforms and rebuilds the shade and raster bind groups a resource change voided. */
export function ensureVisBindings(rt: WebgpuPagesRuntime, device: GPUDevice, tableRows: number) {
  const { vis, gpu, run } = rt,
    [width, height] = gpu.targetSize;
  ({ visUniform: vis.visUniform, shadeUniform: vis.shadeUniform } = writeWebgpuVisibilityUniforms({
    device,
    visUniform: vis.visUniform,
    shadeUniform: vis.shadeUniform,
    visUniPacked: vis.visUniPacked,
    shadeUniPacked: vis.shadeUniPacked,
    width,
    height,
    hasGpuSmall: !!vis.gpuSmall,
    tableRows,
    gpuFrameActive: run.gpuFrameActive,
    maskOffset: run.gpuSelection?.maskOffset ?? 0,
    diagnostic: run.diagnostic,
  }));
  ({
    shadeBindGroup: vis.shadeBindGroup,
    mapsArrayView: vis.mapsArrayView,
    dataMapsArrayView: vis.dataMapsArrayView,
  } = ensureWebgpuShadeBindings({
    device,
    group: vis.shadeBindGroup,
    layout: vis.shadeBindGroupLayout,
    visView: vis.visView,
    pageTable: vis.pageTable,
    cacheBuffer: gpu.cache?.buffer,
    concatPos: vis.concatPos,
    concatUv: vis.concatUv,
    concatNrm: vis.concatNrm,
    mapsTexture: vis.mapsTexture,
    dataMapsTexture: vis.dataMapsTexture,
    mapsSampler: vis.mapsSampler,
    shadeUniform: vis.shadeUniform,
    mapsArrayView: vis.mapsArrayView,
    dataMapsArrayView: vis.dataMapsArrayView,
  }));
  ({
    mapsArrayView: vis.mapsArrayView,
    visBindGroup: vis.visBindGroup,
    visHizBindGroup: vis.visHizBindGroup,
  } = ensureWebgpuVisibilityBindings({
    device,
    layout: vis.visBindGroupLayout,
    cacheBuffer: gpu.cache?.buffer,
    concatPos: vis.concatPos,
    concatUv: vis.concatUv,
    pageTable: vis.pageTable,
    visUniform: vis.visUniform,
    zeroFlags: vis.zeroFlags,
    mapsTexture: vis.mapsTexture,
    mapsSampler: vis.mapsSampler,
    hizFlags: vis.gpuHiz?.flags,
    mapsArrayView: vis.mapsArrayView,
    visBindGroup: vis.visBindGroup,
    visHizBindGroup: vis.visHizBindGroup,
  }));
}

/** Rasterises the small triangles the raster passes skipped, when the compute path is available. */
export function encodeSmallTriangles(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  options: {
    twoPass: boolean;
    tableRows: number;
    maxVertexCount: number;
    idsView: GPUTextureView;
    depthTarget: GPUTextureView;
  },
) {
  const { vis, gpu, run } = rt;
  if (
    !vis.gpuSmall ||
    !gpu.cache ||
    !vis.concatPos ||
    !vis.concatUv ||
    !vis.pageTable ||
    !vis.visUniform ||
    !vis.zeroFlags ||
    !vis.mapsTexture ||
    !vis.mapsSampler
  )
    return;
  // Every row carries its own Hi-Z slot, so a frame that ran no occlusion test is handed the zero
  // flags: the pyramid verdicts of the previous image do not describe this one.
  const hizFlags = options.twoPass && vis.gpuHiz ? vis.gpuHiz.flags : vis.zeroFlags;
  const smallKey = (hizFlags === vis.zeroFlags ? 0 : 1) + (run.gpuFrameActive ? 2 : 0);
  vis.gpuSmall.encode(encoder, {
    indices: gpu.cache.buffer,
    positions: vis.concatPos,
    pages: vis.pageTable,
    hizFlags,
    uniform: vis.visUniform,
    uvs: vis.concatUv,
    maps: (vis.mapsArrayView ??= vis.mapsTexture.createView({ dimension: '2d-array' })),
    sampler: vis.mapsSampler,
    pageRows: options.tableRows,
    maxTriangles: Math.ceil(options.maxVertexCount / 3),
    idsView: options.idsView,
    depthView: options.depthTarget,
    hizView: vis.gpuHiz?.level0View,
    selection: run.gpuFrameActive ? run.gpuSelection : undefined,
    groups: vis.smallGroups,
    groupKey: smallKey,
  });
  run.gpuDrawCalls++;
}
