// The water pass's code, imported with transmission's (`transmissionCode.ts`) by the blend
// stage of the first scene that transmits (`../blend/pipelines.ts`). Its frame side is
// `pass.ts`.
import type { BlendPipelines } from '../blend/stagePipelines.ts'
import { feedbackFreeEntry } from '../tile/feedbackAbWgsl.ts'
import { createWaterFrame, type WaterFrame } from './frame.ts'
import { createWaterSurfacePipelines } from './pipelines.ts'
import { createLobedWaterStage, type LobedWaterStage } from './lobedStage.ts'
import { waterOutFields } from './surfaceWgsl.ts'
import type { Reach } from '../blend/reach.ts'
import type { ForwardLit } from '../../lighting/deferred/forwardVariants.ts'

/** The water pass of a scene: its surface pipelines and its frame side, built at prepare; the
 *  surface stage of an image whose transmissive surface carries a lobe (`lobedStage.ts`). */
export interface WaterPass {
  surfaces: BlendPipelines
  lobed: LobedWaterStage
  frame: WaterFrame
}

/** The blend module's `code`, carrying `fsWater` — and `fsWaterLobed` with `lobes`
 *  (`waterSurfaceWgsl`) —, with their entries that write no feedback, as the blend entries have
 *  theirs. */
export function waterWithoutFeedback(code: string, lobes: boolean) {
  const entry = (from: string, lobed: boolean) => {
    const name = lobed ? 'WaterLobed' : 'Water'
    const input = 'in:VSOut,@builtin(front_facing) front:bool'
    return feedbackFreeEntry(
      from,
      `fs${name}`,
      `${name}Out`,
      waterOutFields(lobed),
      input,
      'in,front',
    )
  }
  const plain = entry(code, false)
  return lobes ? entry(plain, true) : plain
}

/** What the pass is told of the lobes: the blend module that holds the lobed stage
 *  (`fsWaterLobed`), compiled on demand, and whether a transmissive surface carries a lobe now. */
export type WaterLobes = { module: () => Promise<GPUShaderModule | undefined>; now: boolean }

/**
 * Builds the pass for a scene that carries a transmissive item. `module` and `layout` are the
 * blend pass's: the surface stage is one more fragment entry of the same module, on the same bind
 * groups. `lit`: the key the composite's first frame asks for (`createForwardVariants`); `reach`, what
 * the composite must be ready to draw (`../blend/reach.ts`); `lobes`, the lobed stage's module and
 * whether a transmissive surface carries a lobe now: its stage then compiles with the others.
 */
export async function createWaterPass(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback = true,
  unboundedReflections = false,
  lit?: ForwardLit,
  reach?: Reach,
  lobes: WaterLobes = { module: async () => module, now: false },
): Promise<WaterPass> {
  const [surfaces, frame] = await Promise.all([
    createWaterSurfacePipelines(device, module, layout, feedback),
    createWaterFrame(device, unboundedReflections, feedback, lit, reach),
  ])
  const lobed = createLobedWaterStage(device, lobes.module, layout, feedback, frame.restore)
  if (lobes.now) await lobed.prepare()
  return { surfaces, lobed, frame }
}
