import { invertMatrix4 } from '../sdk-core/index.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { writeBlendUniforms } from './webgpuBlendUniforms.ts';
import { encodeTransparentInstances } from './webgpuTransparentDraw.ts';
import { copyBackdrop, writeVolumeUniforms } from './webgpuTransmission.ts';
import { viewProj } from './webgpuPagesHelpers.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { clearValueOf } from './webgpuPagesEncoder.ts';
import { encodeDirectLights } from './webgpuPagesEncodeLights.ts';
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
    !blendState.visibleBlend.length ||
    !gpu.colorView ||
    !gpu.depthView ||
    !gpu.uniformBuffer
  )
    return;
  const textured = !!(
    vis.blendBindGroupLayout &&
    vis.pipelineBlendTextured &&
    vis.colorAtlas &&
    vis.mapsSampler &&
    vis.dataAtlas &&
    vis.materialScales &&
    vis.slots &&
    gpu.zeroUv
  );
  if (!textured && !gpu.bindGroupLayout) return;
  const cpuStart = performance.now();
  // The compaction reads the mask this very frame's cluster cut wrote, a few commands earlier in the
  // same buffer, and writes the instance list the pass below draws from.
  encodeTransparentInstances(rt, encoder);
  ensureUniform(rt, device, uniformBase + blendState.visibleBlend.length);
  writeBlendUniforms(rt, device, uniformBase, textured);
  if (textured) writeVolumeUniforms(rt, device);
  const prepared = performance.now();
  timing.transparentPrepareMs += prepared - cpuStart;
  drawBlendPass(rt, device, encoder, uniformBase, textured);
  // La transmission vient après les mélanges, sur un fond figé : les deux copies séparent les deux
  // passes, si bien qu'aucune surface transmissive ne lit une image à demi composée.
  if (blendState.transmissive && textured && copyBackdrop(rt, encoder))
    drawBlendPass(rt, device, encoder, uniformBase, textured, true);
  const finished = performance.now();
  timing.transparentDrawMs += finished - prepared;
  timing.transparentEncodeMs += finished - cpuStart;
  if (diag.traceEnabled)
    diag.traceDiagnostic('transparent-encoding', 'Transparents sélectionnés et encodés', () => ({
      frame: run.frame,
      submission: run.imageRevision,
      candidates: blendState.blendGpu.length,
      visibleMeshes: blendState.visibleBlend.length,
      frustumRejected: run.blendFrustumRejected,
      drawCalls: run.blendDrawCalls,
      submittedTriangles: run.blendSubmittedTriangles,
      transmissiveMeshes: blendState.transmissive,
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
  cam: EngineCamera,
  uniformBase: number,
) {
  const { gpu, run, capture } = rt,
    { clearColor } = rt.setup;
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.colorView)
    throw new Error('DEFERRED_UNAVAILABLE');
  const [width, height] = gpu.targetSize;
  invertMatrix4(inverseViewProj, viewProj);
  // Les ombres et les listes de lampes s'encodent avant la résolution : elles en sont les entrées.
  const direct = encodeDirectLights(rt, device, encoder, cam, inverseViewProj);
  gpu.deferred.bind(
    gpu.surfaces,
    gpu.depthView,
    gpu.hdrView,
    wantsContractLighting(rt),
    directLightResources(rt),
    (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
  );
  // L'entrée d'image a recopié la caméra, ancêtres compris : la position monde se lit sans recalcul.
  cameraWorldArray[0] = cam.position[0];
  cameraWorldArray[1] = cam.position[1];
  cameraWorldArray[2] = cam.position[2];
  gpu.deferred.update(
    inverseViewProj,
    cameraWorldArray,
    width,
    height,
    clearColor,
    run.diagnostic !== 'beauty',
    direct,
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
