import { invertMatrix4 } from '../../../../../sdk-core/src/index.ts';
import { drawBlendPass } from '../../blend/draw.ts';
import { writeBlendView } from '../../blend/uniforms.ts';
import { encodeBlendExpansion } from '../../blend/resources.ts';
import { selectWebgpuBlend } from '../../blend/selection.ts';
import { orderBlendPasses, orderVisibleBlend } from '../../blend/order.ts';
import {
  DRAW_WORDS,
  drawFallbackBlendPass,
  listFallbackBlendDraws,
  writeFallbackBlendUniforms,
} from '../../blend/fallback.ts';
import { encodeTransparentInstances } from '../../transparent/draw.ts';
import { encodeWaterPass } from '../../water/pass.ts';
import { drawParticles, encodeParticles } from '../../../particles/webgpuParticles.ts';
import { blendLightResources } from '../../blend/lighting.ts';
import { voidStaleBlendGroups } from '../../blend/identity.ts';
import { viewProj } from '../helpers.ts';
import { ensureUniform } from '../prepare/pipelineFor.ts';
import { clearValueOf } from '../../../../../sdk-core/src/world/math/packedColour.ts';
import { encodeDirectLights } from './encodeLights.ts';
import { encodeShadowReadback } from './encodeShadows.ts';
import { composesOffscreen } from '../../../diagnostic/gpuVariant.ts';
import { encodeTaaPass, taaSampledRank } from '../../../taa/frame.ts';
import { encodeEffects } from './encodeEffects.ts';
import {
  directLightResources,
  readsAsIs,
  wantsContractLighting,
} from '../prepare/lightResources.ts';
import { encodeWebgpuGuides, guidesShown } from './encodeGuides.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { EngineCamera } from '../../../camera/world.ts';

const inverseViewProj = new Float64Array(16),
  cameraWorldArray: [number, number, number, number] = [0, 0, 0, 1];

export function encodeBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
  composes: boolean,
) {
  const { gpu, vis, run, timing, blendState, diag } = rt;
  // Every image path reaches this stage: the particles step here, beside the water.
  encodeParticles(rt, device, encoder);
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
    vis.blendPipelines &&
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
    const draws = listFallbackBlendDraws(blendState, run.gpuFrameActive);
    ensureUniform(rt, device, uniformBase + draws.length / DRAW_WORDS);
    writeFallbackBlendUniforms(rt, device, uniformBase, draws);
    const ready = performance.now();
    timing.transparentPrepareMs += ready - cpuStart;
    drawFallbackBlendPass(rt, device, encoder, uniformBase, draws);
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
  // Resolve lighting resources once; a real resource voids a placeholder's bind group.
  voidStaleBlendGroups(rt, blendLightResources(rt));
  // The GPU then expands the sorted plan: an instance list, one indirect argument per slice, and
  // nothing more per item. With no compute stage, the CPU writes the same words.
  encodeBlendExpansion(rt, device, encoder);
  const prepared = performance.now();
  timing.transparentPrepareMs += prepared - cpuStart;
  drawBlendPass(rt, device, encoder);
  // Water comes after blends, on a frozen backdrop: the copy splits the two, so no transmissive
  // surface reads a half-composed image. Without the pass — a diagnostic view, which colours the
  // surface instead of lighting it, a diagnostic variant measuring the blend stage, a capture from
  // a second camera, an image no composition follows — the slice draws as one more blend.
  if (blendState.transmissive && !encodeWaterPass(rt, encoder, composes))
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
  const { gpu, run, capture, blendState } = rt,
    clear = clearValueOf(run.clearColor);
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.colorView)
    throw new Error('DEFERRED_UNAVAILABLE');
  const [width, height] = gpu.targetSize;
  invertMatrix4(inverseViewProj, viewProj);
  // Shadows and light lists encode before resolve: they are its inputs.
  const direct = encodeDirectLights(rt, device, encoder, cam, viewProj);
  gpu.deferred.bind(
    gpu.surfaces,
    gpu.depthView,
    gpu.hdrView,
    wantsContractLighting(rt),
    directLightResources(rt),
    (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
  );
  for (let i = 0; i < 4; i++) cameraWorldArray[i] = cam.viewPoint[i];
  gpu.deferred.update(
    inverseViewProj,
    cameraWorldArray,
    width,
    height,
    run.clearColor,
    run.diagnostic !== 'beauty',
    direct,
    taaSampledRank(rt),
  );
  gpu.reflection?.update(viewProj, gpu.deferred.usesContract && run.diagnostic === 'beauty');
  gpu.deferred.light(encoder, gpu.hdrView, gpu.reflection);
  const blendShare =
    blendState.blendGpu.length && rt.vis.blendPipelines ? gpu.asIsShare : undefined;
  blendShare?.seed(encoder);
  if (gpu.reflection?.active && gpu.deferred.usesContract) run.gpuDrawCalls++;
  run.gpuDrawCalls++;
  encodeShadowReadback(rt, encoder);
  encodeBlend(rt, device, encoder, uniformBase, true);
  drawParticles(rt, encoder);
  // Composition reads the temporal result, or the lit image without accumulation.
  const asIs = readsAsIs(rt);
  const accumulated = encodeTaaPass(rt, device, encoder, cam, gpu.hdrView, asIs, blendShare?.view);
  const effects = encodeEffects(rt, device, encoder, accumulated);
  const composed =
    asIs && blendShare && !accumulated
      ? { ...(effects ?? { color: gpu.hdrView }), share: blendShare.view }
      : effects;
  // A diagnostic variant or guide composes offscreen before presentation.
  const guided = guidesShown(rt);
  const presentation =
    capture.capturing || guided || composesOffscreen(rt.context.diagnosticGpuVariant)
      ? undefined
      : gpu.presenter?.targetView(width, height);
  run.gpuDrawCalls++;
  gpu.deferred.compose(encoder, gpu.colorView, clear, presentation, composed, asIs);
  if (guided) encodeWebgpuGuides(rt, device, encoder, cam);
  return !!presentation;
}
