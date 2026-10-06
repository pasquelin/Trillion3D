import type { GpuPassTiming, GpuPassTimings } from '../../../sdk-core/src/index.ts'
import type { StageAdd } from './profiler.ts'
import { VSM_PASS_PREFIX } from './passLabels.ts'
import { type GpuPassBlock, PASSES, gpuShadowPartOf } from './passTable.ts'

export type { GpuPassBlock } from './passTable.ts'

/** Stage of a pass, by its label: the table's, or `shadows` for a virtual shadow map pass
 *  (`VSM_PASS_PREFIX`). Unknown is `geometry`. */
export const gpuPassStageOf = (name: string) =>
  PASSES[name]?.[0] ?? (name.startsWith(VSM_PASS_PREFIX) ? 'shadows' : 'geometry')
/** Block of a pass, by its label. Unknown is `other`. */
export const gpuPassBlockOf = (name: string): GpuPassBlock => PASSES[name]?.[1] ?? 'other'

/** Stages the WebGPU engine can name, in the order they occur. */
export const WEBGPU_STAGES = [
  'physics',
  'animations',
  'lights',
  'cutAdoption',
  'selection',
  'transparents',
  'residency',
  'hostPages',
  'uploads',
  'textures',
  'partition',
  'encode',
  'submit',
  'hiZ',
  'geometry',
  'coplanar',
  'shadows',
  'shadowCasters',
  'lightLists',
  'bounce',
  'lighting',
  'antialiasing',
  'present',
] as const

/**
 * A pass's own share of the image, ms, or `null` unmeasured: its span less what a pass the queue
 * ran before it already covered (`ownMs`, `../gpu/timing/sample.ts`). A device that overlaps passes
 * — a tiled GPU starts a render pass's vertex stage ahead of the work submitted before it —
 * reports each one's whole span, so spans added up count an overlap once per pass and a stage
 * could pass the image itself; shares add up to the time the passes cover. A timer that times one
 * pass at a time (WebGL2) gives no share: there the span is the share.
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
export function gpuTotalsBy<Group extends string>(
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

/** GPU duration of each profile stage. */
const gpuStageTotals = (sample: GpuPassTimings | null | undefined) =>
  gpuTotalsBy(sample, gpuPassStageOf)

/** Split a sample onto profile stages: what is not measured is not deposited. */
export function addGpuPasses(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [stage, ms] of gpuStageTotals(sample)) if (ms !== null) add(stage, ms)
}

/**
 * GPU duration of a sample's "Bounce" stage, or `null`: that is the measurement the
 * millisecond budget servos. A missing stage, a truncated sample or a device without
 * timestamps yield `null`, and the servo does not move rather than follow a zero.
 */
export function bounceGpuMs(sample: GpuPassTimings | null | undefined) {
  return gpuStageTotals(sample).get('bounce') ?? null
}

/** The direct-lighting durations of the frame, read from the same sample by label. */
export function directLightTimings(sample: GpuPassTimings | null | undefined) {
  const totals = gpuStageTotals(sample),
    parts = gpuTotalsBy(sample, gpuShadowPartOf)
  return {
    gpuLightListsMs: totals.get('lightLists') ?? null,
    gpuShadowsMs: totals.get('shadows') ?? null,
    gpuShadowCullMs: parts.get('cull') ?? null,
    gpuShadowRasterMs: parts.get('raster') ?? null,
    gpuLightingMs: totals.get('lighting') ?? null,
  }
}
