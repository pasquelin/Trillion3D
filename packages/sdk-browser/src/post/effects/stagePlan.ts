import type { EffectPass, EffectStage } from '../../../../sdk-core/src/world/effect/chain.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { showsRaw } from '../../visibility/shader/shadeMode.ts'
import { wanted as finishWanted } from '../finish/wanted.ts'
import { KIND_RULES } from './kindRules.ts'
import { readsMotion } from './kindSettings.ts'

/** The stages of the chain that run around the temporal pass: on the lit image before it, on the image
 *  it resolved after it. */
export type PlanStage = Extract<EffectStage, 'before-resolve' | 'after-resolve'>

/** What an image draws on a stage: the passes of the chain that draw (`KindSettings.drawn`: not idle, not
 *  turned off by the view's settings of their kind), and whether one of them reads the motion the
 *  velocity stage measures (`KIND_RULES[kind].motion`). */
interface StagePlan {
  passes: readonly EffectPass[]
  motion: boolean
}

/** The passes that draw and the plan of each stage, rewritten by each ask: an image allocates none. */
const drawing: Record<PlanStage, EffectPass[]> = { 'before-resolve': [], 'after-resolve': [] }
const plans: Record<PlanStage, StagePlan> = {
  'before-resolve': { passes: drawing['before-resolve'], motion: false },
  'after-resolve': { passes: drawing['after-resolve'], motion: false },
}

/** The image's plan of `stage`, none where the chain holds no pass on it that draws: the view's settings
 *  of the kinds are then not read. */
export function stagePlan(rt: WebgpuPagesRuntime, stage: PlanStage): StagePlan | undefined {
  const chain = rt.context.effects
  if (!chain) return undefined
  const passes = rt.gpu.kindSettings.drawn(chain.stage(stage), rt.context, drawing[stage])
  if (!passes.length) return undefined
  const plan = plans[stage]
  plan.motion = readsMotion(passes)
  return plan
}

/** The passes of the chain that draw, rewritten by each ask: a frame allocates none. */
const asking: EffectPass[] = []

/** Asks, off the frame, the programs each pass of the chain that draws needs beyond its kind's own
 *  compile (`KIND_RULES[kind].ask`): nothing for a view whose image the finishing leaves as it is, nor
 *  for a chain whose passes draw nothing. */
export function askEffectPrograms(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (finishWanted(rt)) askChainPrograms(rt, device)
}

/** The programs of the chain's passes that draw, lit or not yet (`askGlobalPasses`). */
export function askChainPrograms(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const chain = rt.context.effects
  if (!chain) return
  for (const pass of rt.gpu.kindSettings.drawn(chain.passes, rt.context, asking))
    (
      KIND_RULES[pass.kind].ask as
        ((pass: EffectPass, ...rest: [GPUDevice, typeof rt]) => void) | undefined
    )?.(pass, device, rt)
}

/** Whether the image can show the chain's passes on the lit and the resolved image: a finished one
 *  alone — a view that shows raw values, a diagnostic view and a capture show the image as it is. */
export const effectsShown = (rt: WebgpuPagesRuntime) =>
  !showsRaw(rt.run.diagnostic) && finishWanted(rt)

/** Whether a pass that reads the motion draws on this image, which needs the motion measured. */
export const motionWanted = (rt: WebgpuPagesRuntime) =>
  !!stagePlan(rt, 'after-resolve')?.motion && effectsShown(rt)
