import { invertMatrix4 } from '../../../../../sdk-core/src/index.ts';
import { updateScreenReflection } from '../../../reflections/frame.ts';
import { drawParticles } from '../../../particles/webgpuParticles.ts';
import { clearValueOf } from '../../../../../sdk-core/src/world/math/packedColour.ts';
import { directTiles, encodeDirectLights } from './encodeLights.ts';
import { encodeShadowReadback } from './encodeShadows.ts';
import { composesOffscreen } from '../../../diagnostic/gpuVariant.ts';
import { encodeTaaPass, taaSampledRank } from '../../../taa/frame.ts';
import { encodeEffects } from './encodeEffects.ts';
import { seedAsIsShare } from '../prepare/asIsShareTarget.ts';
import {
  directLightResources,
  readsAsIs,
  wantsContractLighting,
} from '../prepare/lightResources.ts';
import { encodeWebgpuGuides, guidesShown } from './encodeGuides.ts';
import { beginDisplayFilter, endDisplayFilter } from './encodeDisplayFilter.ts';
import { encodeBlend } from './encodeBlend.ts';
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
  const [width, height] = gpu.targetSize,
    raw = run.diagnostic !== 'beauty';
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
  // The jitter the raster drew this image with: the shadow level and filters read it (#1363).
  const taa = gpu.temporal?.frame;
  gpu.deferred.setJitter(taa?.active ? taa.jitter : null);
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
  encodeShadowReadback(rt, encoder);
  encodeBlend(rt, device, encoder, uniformBase, true);
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
  if (guided) encodeWebgpuGuides(rt, device, encoder, cam);
  return !!presentation;
}
