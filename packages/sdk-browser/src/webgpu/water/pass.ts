import { countBlendDraws } from '../blend/draw.ts';
import type { BlendPipelines } from '../blend/stagePipelines.ts';
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
): Promise<WaterPass> {
  const [surfaces, frame] = await Promise.all([
    createWaterSurfacePipelines(device, module, layout),
    createWaterFrame(device),
  ]);
  return { surfaces, frame };
}

/**
 * Encodes the water pass after the blends, on the image they left (`frame.ts`).
 * Returns whether the pass was encoded: without a transmissive surface in view, without the
 * pipelines, under a diagnostic view or a capture from a second camera, nothing of it exists in
 * the frame, and the transmission slice draws as one more blend.
 */
export function encodeWaterPass(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, run, capture, blendState } = rt,
    water = blendState.water;
  // A diagnostic view colours a surface instead of lighting it: the slice draws as a blend, whose
  // fragment carries that colouring, and the composite has none. A capture from a second camera
  // reads the surface buffer as opaque once the frame is drawn: the surface stage leaves it alone.
  if (
    run.diagnostic !== 'beauty' ||
    capture.capturing ||
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
