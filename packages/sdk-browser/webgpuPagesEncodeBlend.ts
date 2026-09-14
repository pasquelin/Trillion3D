import * as THREE from 'three';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { writeBlendUniforms } from './webgpuBlendUniforms.ts';
import { viewProj } from './webgpuPagesHelpers.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { clearValueOf } from './webgpuPagesEncoder.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const inverseViewProj = new THREE.Matrix4(),
  cameraWorldScratch = new THREE.Vector3(),
  cameraWorldArray: [number, number, number] = [0, 0, 0];

export function encodeBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
) {
  const { gpu, vis, run, timing, blendState, diag } = rt;
  if (
    !gpu.pipelineBlend ||
    !blendState.visibleBlend.length ||
    !gpu.colorView ||
    !gpu.depthView ||
    !gpu.uniformBuffer
  )
    return;
  const textured = !!(
    vis.blendBindGroupLayout &&
    vis.pipelineBlendTextured &&
    vis.mapsTexture &&
    vis.mapsSampler &&
    vis.dataMapsTexture &&
    vis.materialScales &&
    gpu.zeroUv
  );
  if (!textured && !gpu.bindGroupLayout) return;
  const cpuStart = performance.now();
  ensureUniform(rt, device, uniformBase + blendState.visibleBlend.length);
  writeBlendUniforms(rt, device, uniformBase, textured);
  drawBlendPass(rt, device, encoder, uniformBase, textured);
  timing.transparentEncodeMs += performance.now() - cpuStart;
  if (diag.traceEnabled)
    diag.traceDiagnostic('transparent-encoding', 'Transparents sélectionnés et encodés', () => ({
      frame: run.frame,
      submission: run.imageRevision,
      candidates: blendState.blendGpu.length,
      visibleMeshes: blendState.visibleBlend.length,
      frustumRejected: run.blendFrustumRejected,
      drawCalls: run.blendDrawCalls,
      submittedTriangles: run.blendSubmittedTriangles,
      encodeMs: timing.transparentEncodeMs,
      passes: blendState.visibleBlend.length ? 2 : 0,
    }));
}

/** Lights the surfaces into the HDR target, draws the forward transparents over it, and composes the
 *  display image; returns whether the composition landed on the presented swap-chain view. */
export function encodeSurfaceLighting(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  camera: THREE.PerspectiveCamera,
  uniformBase: number,
) {
  const { gpu, run, capture } = rt,
    { clearColor } = rt.setup;
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.colorView)
    throw new Error('DEFERRED_UNAVAILABLE');
  const [width, height] = gpu.targetSize;
  gpu.deferred.bind(gpu.surfaces, gpu.depthView, gpu.hdrView);
  inverseViewProj.copy(viewProj).invert();
  camera.getWorldPosition(cameraWorldScratch);
  cameraWorldArray[0] = cameraWorldScratch.x;
  cameraWorldArray[1] = cameraWorldScratch.y;
  cameraWorldArray[2] = cameraWorldScratch.z;
  gpu.deferred.update(
    inverseViewProj.elements,
    cameraWorldArray,
    width,
    height,
    clearColor,
    run.diagnostic !== 'beauty',
  );
  gpu.deferred.light(encoder, gpu.hdrView);
  run.gpuDrawCalls++;
  encodeBlend(rt, device, encoder, uniformBase);
  const presentation = capture.secondaryCamera
    ? undefined
    : gpu.presenter?.targetView(width, height);
  run.gpuDrawCalls++;
  gpu.deferred.compose(encoder, gpu.colorView, clearValueOf(clearColor), presentation);
  return !!presentation;
}
