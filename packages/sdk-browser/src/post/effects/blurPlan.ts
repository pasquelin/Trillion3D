import {
  DEPTH_OF_FIELD_RULES,
  type DepthOfFieldValues,
} from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import {
  MOTION_BLUR_RULES,
  type MotionBlurValues,
} from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { MotionBlur } from '../../../../sdk-core/src/world/effect/motionBlur.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { showsRaw } from '../../visibility/shader/shadeMode.ts'
import { wanted as finishWanted } from '../finish/frame.ts'
import { activePasses } from './targets.ts'

/** The view's reading of the motion blur's settings, kept from image to image (`blurPlan`). */
export type BlurWatch = ReturnType<typeof settingsWatch<typeof MOTION_BLUR_RULES>>
/** The view's reading of the depth of field's settings, kept from image to image likewise. */
export type DepthOfFieldWatch = ReturnType<typeof settingsWatch<typeof DEPTH_OF_FIELD_RULES>>

/**
 * What an image draws on the resolved image: the passes of the chain that draw (`activePasses`) —
 * none of a kind whose quality is `'off'`: a motion blur or a depth of field that draws nothing —, how
 * the blur and the depth of field are drawn (`MOTION_BLUR_RULES`, `DEPTH_OF_FIELD_RULES`, as the
 * session holds them), whether one of the passes is a motion blur (`motion`), which needs the motion
 * measured, and whether the settings moved since the image before (`moved`: a view that rests is then
 * drawn again, `effectsMoved`).
 */
export interface BlurPlan {
  passes: readonly EffectPass[]
  settings: MotionBlurValues
  depthOfField: DepthOfFieldValues
  motion: boolean
  moved: boolean
}

const NO_PASSES: readonly EffectPass[] = []
/** The passes that draw, those the settings keep, and the plan, rewritten by each ask: an image
 *  allocates none. */
const drawing: EffectPass[] = []
const kept: EffectPass[] = []
const plan: BlurPlan = {
  passes: NO_PASSES,
  settings: undefined as never,
  depthOfField: undefined as never,
  motion: false,
  moved: false,
}

/** Whether the settings turn `pass` off: a blur or a depth of field of quality `'off'` draws none. */
const turnedOff = (pass: EffectPass) =>
  pass.kind === 'motionBlur'
    ? plan.settings.motionBlurQuality === 'off'
    : pass.kind === 'depthOfField' && plan.depthOfField.depthOfFieldQuality === 'off'

/** The image's plan, none where the chain holds no pass on the resolved image that draws: its settings
 *  are then not read. */
export function blurPlan(rt: WebgpuPagesRuntime): BlurPlan | undefined {
  const chain = rt.context.effects
  if (!chain || !activePasses(chain.stage('after-resolve'), drawing).length) return undefined
  const watch = (rt.gpu.motionBlurWatch ??= settingsWatch(MOTION_BLUR_RULES))
  const depth = (rt.gpu.depthOfFieldWatch ??= settingsWatch(DEPTH_OF_FIELD_RULES))
  plan.settings = watch.read(rt.context)
  plan.depthOfField = depth.read(rt.context)
  plan.moved = watch.moved || depth.moved
  kept.length = 0
  plan.motion = false
  for (const pass of drawing) {
    if (turnedOff(pass)) continue
    kept.push(pass)
    plan.motion ||= pass.kind === 'motionBlur'
  }
  plan.passes = kept
  return plan
}

/** The smallest object, in percent of the screen, whose own motion the view's passes measure
 *  (`perObjectSize`): the first motion blur of the chain's, drawing or not — the view's setting, as
 *  a post-process volume's is —; 0, which leaves none out, where the chain holds none. */
export function perObjectSizeOf(rt: WebgpuPagesRuntime) {
  for (const pass of rt.context.effects?.stage('after-resolve') ?? [])
    if (pass instanceof MotionBlur) return pass.perObjectSize
  return 0
}

/** Whether the image can show the blur: a finished one alone — a view that shows raw values, a
 *  diagnostic view and a capture show the image as it is. */
export const blurShown = (rt: WebgpuPagesRuntime) =>
  !showsRaw(rt.run.diagnostic) && finishWanted(rt)

/** Whether a motion blur draws on this image, which needs the motion measured. */
export const blurWanted = (rt: WebgpuPagesRuntime) => !!blurPlan(rt)?.motion && blurShown(rt)

/** Whether the blur's settings moved since the image before: one that can show it is drawn again. */
export const blurSettingsMoved = (rt: WebgpuPagesRuntime) =>
  rt.gpu.motionBlurWatch !== undefined && !!blurPlan(rt)?.moved && blurShown(rt)
