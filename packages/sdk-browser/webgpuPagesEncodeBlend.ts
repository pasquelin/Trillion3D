import { invertMatrix4 } from '../sdk-core/index.ts';
import { drawBlendPass } from './webgpuBlendDraw.ts';
import { writeBlendView } from './webgpuBlendUniforms.ts';
import { writeBlendArgsCpu } from './webgpuBlendArgs.ts';
import { selectWebgpuBlend } from './webgpuBlendSelection.ts';
import { drawFallbackBlendPass, writeFallbackBlendUniforms } from './webgpuBlendFallback.ts';
import { encodeTransparentInstances } from './webgpuTransparentDraw.ts';
import { copyBackdrop } from './webgpuTransmission.ts';
import { viewProj } from './webgpuPagesHelpers.ts';
import { ensureUniform } from './webgpuPagesPipelineFor.ts';
import { clearValueOf } from './webgpuPagesEncoder.ts';
import { encodeDirectLights } from './webgpuPagesEncodeLights.ts';
import { composesOffscreen } from './diagnosticGpuVariant.ts';
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
    vis.colorAtlas &&
    vis.mapsSampler &&
    vis.dataAtlas &&
    vis.materialScales &&
    vis.slots &&
    vis.concatPos &&
    vis.concatUv &&
    vis.concatNrm &&
    gpu.zeroUv &&
    blendState.itemBuffer &&
    blendState.viewBuffer &&
    blendState.argsBuffer
  );
  if (!textured && !gpu.bindGroupLayout) return;
  const cpuStart = performance.now();
  // The compaction reads the mask this very frame's cluster cut wrote, a few commands earlier in the
  // same buffer, and writes the instance list the pass below draws from.
  encodeTransparentInstances(rt, encoder);
  if (!textured) {
    run.blendFrustumRejected = selectWebgpuBlend(
      blendState,
      run.gpuFrameActive ? undefined : run.drawn,
    );
    ensureUniform(rt, device, uniformBase + blendState.visibleBlend.length);
    writeFallbackBlendUniforms(rt, device, uniformBase);
    const ready = performance.now();
    timing.transparentPrepareMs += ready - cpuStart;
    drawFallbackBlendPass(rt, device, encoder, uniformBase);
    timing.transparentDrawMs += performance.now() - ready;
    timing.transparentEncodeMs += performance.now() - cpuStart;
    return;
  }
  // Le tronc passe par la carte : un noyau d'un fil par item ecrit les arguments indirects, compte
  // d'instances a zero pour ce qu'il rejette. Sans etage de calcul, le processeur ecrit les memes
  // arguments. Le compteur de rejets, lui, ne vient d'aucune relecture : `drawBlendPass` le tient
  // en retestant le tronc en double precision, sur l'image qu'il encode.
  writeBlendView(rt, device);
  if (blendState.select) blendState.select.encode(encoder, blendState.blendPlanes);
  else writeBlendArgsCpu(blendState, device);
  const prepared = performance.now();
  timing.transparentPrepareMs += prepared - cpuStart;
  drawBlendPass(rt, device, encoder);
  // La transmission vient apres les melanges, sur un fond fige : les deux copies separent les deux
  // passes, si bien qu'aucune surface transmissive ne lit une image a demi composee.
  if (blendState.transmissive && copyBackdrop(rt, encoder))
    drawBlendPass(rt, device, encoder, true);
  const finished = performance.now();
  timing.transparentDrawMs += finished - prepared;
  timing.transparentEncodeMs += finished - cpuStart;
  if (diag.traceEnabled)
    diag.traceDiagnostic('transparent-encoding', 'Transparents selectionnes et encodes', () => ({
      frame: run.frame,
      submission: run.imageRevision,
      candidates: blendState.blendGpu.length,
      visibleMeshes: blendState.visibleBlend.length,
      frustumRejected: run.blendFrustumRejected,
      drawCalls: run.blendDrawCalls,
      submittedTriangles: run.blendSubmittedTriangles,
      transmissiveMeshes: blendState.transmissive,
      encodeMs: timing.transparentEncodeMs,
      passes: blendState.planTransmission.length ? 2 : 1,
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
  );
  gpu.deferred.light(encoder, gpu.hdrView);
  run.gpuDrawCalls++;
  encodeBlend(rt, device, encoder, uniformBase);
  // Diagnostic seul : la variante hors écran ne demande pas la vue de la chaîne d'échange. La passe
  // de composition reste la même, à une cible de couleur près — c'est ce qui isole la présentation.
  const presentation =
    capture.secondaryCamera || composesOffscreen(rt.context.diagnosticGpuVariant)
      ? undefined
      : gpu.presenter?.targetView(width, height);
  run.gpuDrawCalls++;
  gpu.deferred.compose(encoder, gpu.colorView, clearValueOf(clearColor), presentation);
  return !!presentation;
}
