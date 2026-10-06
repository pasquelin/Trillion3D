// The water pass's code, imported with transmission's (`transmissionCode.ts`) by the blend
// stage of the first scene that transmits (`../blend/pipelines.ts`), #1353. Its frame side is
// `pass.ts`.
import type { BlendPipelines } from '../blend/stagePipelines.ts'
import { feedbackFreeEntry } from '../tile/feedbackAbWgsl.ts'
import { createWaterFrame, type WaterFrame } from './frame.ts'
import { createWaterSurfacePipelines } from './pipelines.ts'
import type { Reach } from '../blend/reach.ts'
import type { ForwardLit } from '../../lighting/deferred/contractVariants.ts'

/** The water pass of a scene: its surface pipelines and its frame side, built at prepare. */
export interface WaterPass {
  surfaces: BlendPipelines
  frame: WaterFrame
}

/** The blend module's `code`, carrying `fsWater`, with its entry that writes no feedback, as the
 *  blend entries have theirs. */
export function waterWithoutFeedback(code: string) {
  const out: [string, string][] = ['baseMetal', 'normalRough', 'emissiveAo', 'word'].map((name) => [
    name,
    'vec4f',
  ])
  const input = 'in:VSOut,@builtin(front_facing) front:bool'
  return feedbackFreeEntry(code, 'fsWater', 'WaterOut', out, input, 'in,front')
}

/**
 * Builds the pass for a scene that carries a transmissive item. `module` and `layout` are the
 * blend pass's: the surface stage is one more fragment entry of the same module, on the same bind
 * groups. `lit`: the key the composite's first frame asks for (`createForwardVariants`); `reach`, what
 * the composite must be ready to draw (`../blend/reach.ts`).
 */
export async function createWaterPass(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback = true,
  unboundedReflections = false,
  lit?: ForwardLit,
  reach?: Reach,
): Promise<WaterPass> {
  const [surfaces, frame] = await Promise.all([
    createWaterSurfacePipelines(device, module, layout, feedback),
    createWaterFrame(device, unboundedReflections, feedback, lit, reach),
  ])
  return { surfaces, frame }
}
