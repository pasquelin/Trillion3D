import { countBlendDraws } from '../blend/draw.ts';
import type { BlendPipelines } from '../blend/stagePipelines.ts';
import { beginWaterBounds } from './bounds.ts';
import { createWaterFrame, type WaterFrame } from './frame.ts';
import { createWaterSurfacePipelines } from './pipelines.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The water pass of a scene: its surface pipelines and its frame side, built at prepare. */
export interface WaterPass {
  surfaces: BlendPipelines;
  frame: WaterFrame;
}

/**
 * Builds the pass for a scene that carries a transmissive item. `module` and `layout` are the
 * blend pass's: the surface stage is one more fragment entry of the same module, on the same bind
 * groups.
 */
export async function createWaterPass(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback = true,
): Promise<WaterPass> {
  const [surfaces, frame] = await Promise.all([
    createWaterSurfacePipelines(device, module, layout, feedback),
    createWaterFrame(device),
  ]);
  return { surfaces, frame };
}

/** Whether this image composes water: a beauty view, no second-camera capture, a composition. */
function composesWater(rt: WebgpuPagesRuntime, composes: boolean) {
  return rt.run.diagnostic === 'beauty' && !rt.capture.capturing && composes && !!rt.blendState.water;
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
 * Encodes the water pass after the blends, on the image they left (`frame.ts`).
 * Returns whether the pass was encoded: without a transmissive surface in view, without the
 * pipelines, under a diagnostic view or a capture from a second camera, nothing of it exists in
 * the frame, and the transmission slice draws as one more blend. So too when no composition
 * `composes` the image after it: the water word borrows the display colour (`surfaceWgsl.ts`),
 * which only that composition writes over.
 */
export function encodeWaterPass(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  composes = true,
) {
  const { gpu, run, blendState } = rt,
    water = blendState.water;
  // A diagnostic view colours a surface instead of lighting it: the slice draws as a blend, whose
  // fragment carries that colouring, and the composite has none. A capture from a second camera
  // reads the surface buffer as opaque once the frame is drawn: the surface stage leaves it alone.
  if (
    !composesWater(rt, composes) ||
    !water ||
    !blendState.transmissiveInView ||
    !blendState.argsBuffer ||
    !blendState.viewBuffer ||
    !blendState.lighting ||
    !water.frame.bind(gpu, blendState.viewBuffer, blendState.lighting)
  )
    return false;
  countBlendDraws(rt, water.frame.encode(rt, encoder, water.surfaces), true);
  run.gpuDrawCalls++;
  return true;
}
