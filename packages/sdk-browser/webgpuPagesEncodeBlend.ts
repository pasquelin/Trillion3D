import { invertMatrix4 } from '../sdk-core/index.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { writeBlendView } from './webgpuBlendUniforms.ts';
import { encodeBlendExpansion } from './webgpuBlendResources.ts';
import { selectWebgpuBlend } from './webgpuBlendSelection.ts';
import { orderBlendPasses, orderVisibleBlend } from './webgpuBlendOrder.ts';
import { drawFallbackBlendPass, writeFallbackBlendUniforms } from './webgpuBlendFallback.ts';
import { encodeTransparentInstances } from './webgpuTransparentDraw.ts';
import { copyBackdrop } from './webgpuTransmission.ts';
import { viewProj } from './webgpuPagesHelpers.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { clearValueOf } from './webgpuPagesEncoder.ts';
import { encodeDirectLights } from './webgpuPagesEncodeLights.ts';
import { composesOffscreen } from './diagnosticGpuVariant.ts';
import { encodeTaaPass, taaSampledRank } from './taaFrame.ts';
import { directLightResources, wantsContractLighting } from './webgpuPagesLightResources.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { EngineCamera } from './cameraWorld.ts';

const inverseViewProj = new Float64Array(16),
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
    !blendState.blendGpu.length ||
    !gpu.colorView ||
    !gpu.depthView ||
    !gpu.uniformBuffer
  )
    return;
  const textured = !!(
    vis.blendBindGroupLayout &&
    vis.pipelineBlendTextured &&
    vis.textures &&
    vis.mapsSampler &&
    vis.concatPos &&
    vis.concatUv &&
    vis.concatNrm &&
    gpu.zeroUv &&
    blendState.itemBuffer &&
    blendState.viewBuffer &&
    blendState.argsBuffer &&
    blendState.expandedBuffer
  );
  if (!textured && !gpu.bindGroupLayout) return;
  const cpuStart = performance.now();
  // World-space eye of the image, the same one the view uniform publishes: with no camera, no image
  // is sorted and the lists keep the order they had.
  const eye = run.lastCamera ? run.gate.cam.eye : undefined;
  // The compaction reads the mask this very frame's cluster cut wrote, a few commands earlier in the
  // same buffer, and writes the instance list the pass below draws from.
  encodeTransparentInstances(rt, encoder);
  if (!textured) {
    run.blendFrustumRejected = selectWebgpuBlend(
      blendState,
      run.gpuFrameActive ? undefined : run.drawn,
    );
    orderVisibleBlend(blendState, eye);
    ensureUniform(rt, device, uniformBase + blendState.visibleBlend.length);
    writeFallbackBlendUniforms(rt, device, uniformBase);
    const ready = performance.now();
    timing.transparentPrepareMs += ready - cpuStart;
    drawFallbackBlendPass(rt, device, encoder, uniformBase);
    timing.transparentDrawMs += performance.now() - ready;
    timing.transparentEncodeMs += performance.now() - cpuStart;
    return;
  }
  // Far-to-near sort, taken here every image: a blend writes no depth, so nothing else splits two
  // transparent surfaces. The frustum is tested in the same walk, in double precision, and its
  // verdict goes to the GPU as one bit per item — that is also THE image's reject count, measured
  // where it drops the draw.
  run.blendFrustumRejected = orderBlendPasses(blendState, eye);
  writeBlendView(rt, device);
  // The GPU then expands the sorted plan: an instance list, one indirect argument per slice, and
  // nothing more per item. With no compute stage, the CPU writes the same words.
  encodeBlendExpansion(rt, device, encoder);
  const prepared = performance.now();
  timing.transparentPrepareMs += prepared - cpuStart;
  drawBlendPass(rt, device, encoder);
  // Transmission comes after blends, on a frozen backdrop: the two copies split the two passes, so
  // no transmissive surface reads a half-composed image.
  if (blendState.transmissive && copyBackdrop(rt, encoder))
    drawBlendPass(rt, device, encoder, true);
  const finished = performance.now();
  timing.transparentDrawMs += finished - prepared;
  timing.transparentEncodeMs += finished - cpuStart;
  if (diag.traceEnabled)
    diag.traceDiagnostic(
      'transparent-encoding',
      'Transparent surfaces selected and encoded',
      () => ({
        frame: run.frame,
        submission: run.imageRevision,
        candidates: blendState.blendGpu.length,
        visibleMeshes: blendState.visibleBlend.length,
        frustumRejected: run.blendFrustumRejected,
        drawCalls: run.blendDrawCalls,
        submittedTriangles: run.blendSubmittedTriangles,
        transmissiveMeshes: blendState.transmissive,
        encodeMs: timing.transparentEncodeMs,
        passes: blendState.orders[1].length ? 2 : 1,
      }),
    );
}

/** Lights the surfaces into the HDR target, draws the forward transparents over it, and composes the
 *  display image; returns whether the composition landed on the presented swap-chain view. */
export function encodeSurfaceLighting(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  uniformBase: number,
) {
  const { gpu, run, capture } = rt,
    { clearColor } = rt.setup;
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.colorView)
    throw new Error('DEFERRED_UNAVAILABLE');
  const [width, height] = gpu.targetSize;
  invertMatrix4(inverseViewProj, viewProj);
  // Shadows and light lists encode before resolve: they are its inputs.
  const direct = encodeDirectLights(rt, device, encoder, cam, inverseViewProj);
  gpu.deferred.bind(
    gpu.surfaces,
    gpu.depthView,
    gpu.hdrView,
    wantsContractLighting(rt),
    directLightResources(rt),
    (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
  );
  // Image entry copied the camera, ancestors included: world position is read without recomputing.
  cameraWorldArray[0] = cam.eye[0];
  cameraWorldArray[1] = cam.eye[1];
  cameraWorldArray[2] = cam.eye[2];
  gpu.deferred.update(
    inverseViewProj,
    cameraWorldArray,
    width,
    height,
    clearColor,
    run.diagnostic !== 'beauty',
    direct,
    taaSampledRank(rt),
  );
  gpu.deferred.light(encoder, gpu.hdrView);
  run.gpuDrawCalls++;
  encodeBlend(rt, device, encoder, uniformBase);
  // Temporal accumulation reads the lit and blended image, and yields what composition reads — the
  // image as-is when this image does not accumulate.
  const composed = encodeTaaPass(rt, device, encoder, cam, gpu.hdrView);
  // Diagnostic only: the off-screen variant does not ask for the swap-chain view. The composition
  // pass stays the same, one colour target aside — that is what isolates presentation.
  const presentation =
    capture.secondaryCamera || composesOffscreen(rt.context.diagnosticGpuVariant)
      ? undefined
      : gpu.presenter?.targetView(width, height);
  run.gpuDrawCalls++;
  gpu.deferred.compose(encoder, gpu.colorView, clearValueOf(clearColor), presentation, composed);
  return !!presentation;
}
