import type { GpuPassTiming, GpuPassTimings } from '../../../sdk-core/src/index.ts'
import type { StageAdd } from './profiler.ts'
import { WEBGPU_STAGES, type GpuPassBlock, type WebgpuStage } from './passDeclaration.ts'
import { passRowOf } from './passTable.ts'

/** Stage of a pass, by its label: its row's (`passRowOf`). A label no declaration names joins no
 *  stage (`undefined`). */
export const gpuPassStageOf = (name: string): WebgpuStage | undefined => passRowOf(name)?.stage
/** Block of a pass, by its label: its row's. A label no declaration names joins no block
 *  (`undefined`). */
export const gpuPassBlockOf = (name: string): GpuPassBlock | undefined => passRowOf(name)?.block

/**
 * A pass's own share of the image, ms, or `null` unmeasured: its span less what a pass the queue
 * ran before it already covered (`ownMs`, `../gpu/timing/sample.ts`). A device that overlaps passes
 * — a tiled GPU starts a render pass's vertex stage ahead of the work submitted before it —
 * reports each one's whole span, so spans added up count an overlap once per pass and a stage
 * could pass the image itself; shares add up to the time the passes cover. A pass with no share
 * measured counts its span.
 */
export const passOwnMs = (pass: GpuPassTiming) =>
  pass.gpuMs === null ? null : (pass.ownMs ?? pass.gpuMs)

/**
 * GPU duration of a sample by pass group, in one walk, `classify` naming each pass's group or none
 * (the pass is left out): the passes' own shares (`passOwnMs`), so the groups together never pass
 * the time the timed passes cover. `null` for a group whose one pass has no usable duration: a
 * partial sum would pass for a measurement. A truncated or missing sample yields no group, for the
 * same reason.
 */
export function gpuTotalsBy<Group extends string | number>(
  sample: GpuPassTimings | null | undefined,
  classify: (name: string) => Group | undefined,
) {
  const totals = new Map<Group, number | null>()
  if (!sample || sample.truncated) return totals
  for (const pass of sample.passes) {
    const group = classify(pass.name)
    if (group === undefined) continue
    const total = totals.get(group)
    if (total === null) continue
    const ms = passOwnMs(pass)
    totals.set(group, ms === null ? null : (total ?? 0) + ms)
  }
  return totals
}

/** GPU duration of each profile stage, by its index in `WEBGPU_STAGES`. */
const gpuStageTotals = (sample: GpuPassTimings | null | undefined) =>
  gpuTotalsBy(sample, (name) => passRowOf(name)?.at)

/** The stages the engine's own readers take from a sample, by index. */
const BOUNCE = WEBGPU_STAGES.indexOf('bounce'),
  LIGHT_LISTS = WEBGPU_STAGES.indexOf('lightLists'),
  SHADOWS = WEBGPU_STAGES.indexOf('shadows'),
  LIGHTING = WEBGPU_STAGES.indexOf('lighting')

/** Split a sample onto the stages of `WEBGPU_STAGES`, by index: what is not measured is not
 *  deposited. */
export function addGpuPasses(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [at, ms] of gpuStageTotals(sample)) if (ms !== null) add(at, ms)
}

/**
 * GPU duration of a sample's "Bounce" stage, or `null`: that is the measurement the
 * millisecond budget servos. A missing stage, a truncated sample or a device without
 * timestamps yield `null`, and the servo does not move rather than follow a zero.
 */
export function bounceGpuMs(sample: GpuPassTimings | null | undefined) {
  return gpuStageTotals(sample).get(BOUNCE) ?? null
}

/** The direct-lighting durations of the frame, read from the same sample by label. */
export function directLightTimings(sample: GpuPassTimings | null | undefined) {
  const totals = gpuStageTotals(sample)
  return {
    gpuLightListsMs: totals.get(LIGHT_LISTS) ?? null,
    gpuShadowsMs: totals.get(SHADOWS) ?? null,
    gpuLightingMs: totals.get(LIGHTING) ?? null,
  }
}
