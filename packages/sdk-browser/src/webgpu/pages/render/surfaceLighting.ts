import { invertMatrix4 } from '../../../../../sdk-core/src/index.ts';
import { updateScreenReflection } from '../../../reflections/frame.ts';
import { drawParticles } from '../../../particles/webgpuParticleFrame.ts';
import { clearValueOf } from '../../../../../sdk-core/src/world/math/packedColour.ts';
import { directTiles, encodeDirectLights } from './encodeLights.ts';
import { finishVsmFrame } from './vsm/vsmFrameEnd.ts';
import { composesOffscreen } from '../../../diagnostic/gpuVariant.ts';
import { encodeTaaPass, taaSampledRank } from '../../../taa/frame.ts';
import { stochasticPhase } from '../../../taa/frameState.ts';
import { encodeEffects } from './encodeEffects.ts';
import { seedAsIsShare } from '../prepare/asIsShareTarget.ts';
import {
  directLightResources,
  readsAsIs,
  wantsContractLighting,
} from '../prepare/lightResources.ts';
import { encodeWebgpuGuides, guidesShown } from './encodeGuides.ts';
import { beginDisplayFilter, endDisplayFilter } from './encodeDisplayFilter.ts';
import { encodeBlend, prepareBlend } from './encodeBlend.ts';
import { viewProj } from '../helpers.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { EngineCamera } from '../../../camera/world.ts';

const inverseViewProj = new Float64Array(16),
  cameraWorldArray: [number, number, number, number] = [0, 0, 0, 1];

/** Lights the surfaces into the HDR target, draws the forward transparents over it, and composes the
 *  display image at its size; returns whether it landed on the presented swap-chain view. */
export function encodeSurfaceLighting(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  uniformBase: number,
) {
  const { gpu, run, capture } = rt,
    clear = clearValueOf(run.clearColor);
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.displayView)
    throw new Error('DEFERRED_UNAVAILABLE');
  // The impostor cards complete the opaque surfaces before anything reads them.
  rt.gpu.impostorCode?.encodeImpostorCards(rt, encoder);
  const [width, height] = gpu.targetSize,
    raw = run.diagnostic !== 'beauty';
  invertMatrix4(inverseViewProj, viewProj);
  // The transparents are selected and ordered first; light lists encode before resolve, its inputs.
  const blendRuns = prepareBlend(rt, device, encoder, true);
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
  // The jitter the raster drew this image with: the shadow level reads it (#1363).
  const taa = gpu.temporal?.frame;
  gpu.deferred.setJitter(taa?.active ? taa.jitter : null, stochasticPhase(taa));
  gpu.deferred.update(
    inverseViewProj,
    cameraWorldArray,
    width,
    height,
    run.clearColor,
    raw,
    direct,
    taaSampledRank(rt),
  );
  updateScreenReflection(rt, viewProj, gpu.deferred.usesContract && !raw);
  run.gpuDrawCalls += gpu.deferred.light(encoder, gpu.hdrView, gpu.reflection);
  const blendShare = seedAsIsShare(rt, device, encoder);
  const filter = beginDisplayFilter(rt, device);
  encodeBlend(rt, device, encoder, uniformBase, true, blendRuns);
  drawParticles(rt, encoder, directTiles());
  // Composition reads the temporal result, or the lit image without accumulation.
  const asIs = readsAsIs(rt);
  const accumulated = encodeTaaPass(rt, device, encoder, cam, gpu.hdrView, asIs, blendShare?.view);
  const effects = encodeEffects(rt, device, encoder, accumulated);
  const composed =
    asIs && blendShare && !accumulated
      ? { ...(effects ?? { color: gpu.hdrView }), share: blendShare.view }
      : effects;
  // A diagnostic variant, a guide or a view placed at a canvas rectangle composes offscreen.
  const guided = guidesShown(rt),
    placed = !!rt.views.active.rect;
  const presentation =
    capture.capturing || guided || placed || composesOffscreen(rt.context.diagnosticGpuVariant)
      ? undefined
      : gpu.presenter?.targetView(...gpu.displaySize);
  run.gpuDrawCalls++;
  gpu.deferred.compose(encoder, gpu.displayView, clear, presentation, composed, asIs);
  if (filter) endDisplayFilter(rt, filter, encoder, accumulated?.filter, presentation);
  // Composition and filter wrote the canvas what they wrote the display colour: it holds it.
  if (presentation) gpu.presenter!.composed(gpu.displayTexture!, ...gpu.displaySize);
  if (guided) encodeWebgpuGuides(rt, encoder, cam);
  // The transparents and water read this frame's maps: the frame's buffers swap only now.
  finishVsmFrame(rt, encoder);
  return !!presentation;
}
