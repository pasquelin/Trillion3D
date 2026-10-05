// The water pass's frame side: its bounds and its encoding, on the pass the blend stage built
// once its code arrived (`waterPass.ts`).
import { countBlendDraws } from '../blend/draw.ts';
import { beginWaterBounds } from './bounds.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { ContractKey } from '../../lighting/deferred/contractVariants.ts';
import { directLightResources } from '../pages/prepare/lightResources.ts';

/** Whether this image composes water: a beauty view, no second-camera capture, a composition. */
function composesWater(rt: WebgpuPagesRuntime, composes: boolean) {
  return (
    rt.run.diagnostic === 'beauty' && !rt.capture.capturing && composes && !!rt.blendState.water
  );
}

/**
 * Opens the image's water bounds before the frustum walk fills them with its kept transmissive
 * items (`../blend/hierarchyCull.ts`), under the image's jittered `projection`. An image without
 * the pass leaves them inactive, and the pass, if any, covers the full target.
 */
export function boundWaterPass(
  rt: WebgpuPagesRuntime,
  composes: boolean,
  projection: ArrayLike<number>,
) {
  const wanted = composesWater(rt, composes) && rt.blendState.transmissive > 0;
  beginWaterBounds(
    rt.blendState.waterBounds,
    wanted ? rt.run.gate.cam : undefined,
    projection,
    rt.gpu.targetSize,
  );
}

/**
 * Whether the water pass draws the image's transmission slice, as far as the frame knows before
 * it binds: the pass encodes on it.
 */
function drawsWater(rt: WebgpuPagesRuntime, composes: boolean) {
  const { blendState } = rt;
  return (
    composesWater(rt, composes) &&
    blendState.transmissiveInView > 0 &&
    !!blendState.argsBuffer &&
    !!blendState.viewBuffer &&
    !!blendState.lighting
  );
}

/**
 * Encodes the water pass after the blends, on the image they left (`frame.ts`).
 * Returns whether the pass was encoded: without a transmissive surface in view, without the
 * pipelines, under a diagnostic view or a capture from a second camera, nothing of it exists in
 * the frame, and the transmission slice draws as one more blend. So too when no composition
 * `composes` the image after it: the water word borrows the display colour (`surfaceWgsl.ts`),
 * which only that composition writes over. `key`, the frame's lights' key (`directLightResources`,
 * resolved here when not given), picks the composite's program (`frame.ts`).
 */
export function encodeWaterPass(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  composes = true,
  key?: Partial<ContractKey>,
) {
  const { gpu, run, blendState } = rt,
    water = blendState.water;
  // A diagnostic view colours a surface instead of lighting it: the slice draws as a blend, whose
  // fragment carries that colouring, and the composite has none. A capture from a second camera
  // reads the surface buffer as opaque once the frame is drawn: the surface stage leaves it alone.
  const { viewBuffer, lighting } = blendState;
  if (
    !drawsWater(rt, composes) ||
    !water ||
    !viewBuffer ||
    !lighting ||
    !water.frame.bind(gpu, viewBuffer, lighting)
  )
    return false;
  const lit = key ?? directLightResources(rt);
  countBlendDraws(rt, water.frame.encode(rt, encoder, water.surfaces, lit), true);
  run.gpuDrawCalls++;
  return true;
}
