import { adapterSubgroupSizes } from '../../gpu/core/subgroups.ts'
import { readTemporalSetting } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * The subgroup variants and the 16-bit variants of the temporal pass, chosen for a device and the
 * settings (`temporalWaveOps`, `temporalWaveSize`, `temporalHalfPrecision`,
 * `../../../../sdk-core/src/contracts/temporalOptions.ts`), each with the reference's default.
 */

/** The lanes of a subgroup the wave variants are written for: the sizes the choice is made among. */
const WAVE_SIZES = [16, 32, 64] as const

/**
 * A wave variant: a workgroup of `lanes` invocations that is one subgroup of `lanes` lanes, so a
 * lane's place in the workgroup is its place in the subgroup (`subgroup_invocation_id`) and a
 * shuffle reaches the lane the pixel's neighbour sits at (WGSL gives no other relation between
 * `local_invocation_index` and the subgroup: § 15.5 "Subgroups" of the WGSL specification, "There
 * is no defined relationship between subgroup values … and local_invocation_index",
 * https://www.w3.org/TR/WGSL/). `pinned`: the program fixes the size with `@subgroup_size`
 * (the feature `subgroup-size-control`, § 25.23 of the WebGPU specification), as the adapter runs
 * subgroups of more than one size; else the adapter's only size is `lanes`.
 */
export interface Wave {
  readonly lanes: (typeof WAVE_SIZES)[number]
  readonly pinned: boolean
}

/** What the device runs the pass's programs as: the wave variant, none for the plain ones, and
 *  whether the programs that have a 16-bit variant run in it. */
export interface TaaExecution {
  readonly wave: Wave | undefined
  readonly half: boolean
  /** Names the whole choice: two executions of one key are the one execution. */
  readonly key: string
}

/**
 * The wave variant `device` runs when the wave variants are on (`waveOps`) and none otherwise.
 * It needs the feature `subgroups` and the subgroup sizes of the adapter; the size is `waveSize`
 * where it is one of `WAVE_SIZES` the adapter runs, else the least size the adapter runs that the
 * variants are written for — its smallest, held to 16 —, none when that is past 64 or past the
 * adapter's largest (a size outside the adapter's range is a pipeline the driver refuses): the
 * choice among the sizes 16, 32 and 64. The variants fix their size
 * (`Wave.pinned`): by the adapter, whose only size it is, else by the feature
 * `subgroup-size-control` — an adapter running other sizes without it runs the plain variants.
 */
function waveOf(device: GPUDevice, waveOps: boolean, waveSize: number): Wave | undefined {
  if (!waveOps || !device.features.has('subgroups')) return undefined
  const sizes = adapterSubgroupSizes(device)
  const min = sizes?.subgroupMinSize,
    max = sizes?.subgroupMaxSize
  if (!min || !max) return undefined
  const asked = WAVE_SIZES.find((size) => size === waveSize && size >= min && size <= max)
  const lanes =
    asked ?? WAVE_SIZES.find((size) => size === Math.max(min, WAVE_SIZES[0]) && size <= max)
  if (!lanes) return undefined
  if (min === lanes && max === lanes) return { lanes, pinned: false }
  return device.features.has('subgroup-size-control') ? { lanes, pinned: true } : undefined
}

/** The executions made, by device and setting, and by key: the one object for one choice, so a frame
 *  that asks again allocates nothing. */
const made = new WeakMap<
  GPUDevice,
  { asked: Map<number, TaaExecution>; keyed: Map<string, TaaExecution> }
>()

/**
 * The execution of `device` for the settings `waveOps`, `waveSize` and `halfPrecision`, the one object
 * for the same choice (`TaaExecution.key`). The 16-bit programs are run where the setting asks and the
 * device grants 16-bit shader floats (`shader-f16`, § 25.11 of the WebGPU specification).
 */
export function taaExecutionOf(
  device: GPUDevice,
  waveOps: boolean,
  waveSize: number,
  halfPrecision = true,
): TaaExecution {
  let held = made.get(device)
  if (!held) made.set(device, (held = { asked: new Map(), keyed: new Map() }))
  const ask = (waveSize << 2) | (waveOps ? 1 : 0) | (halfPrecision ? 2 : 0)
  let execution = held.asked.get(ask)
  if (execution) return execution
  const wave = waveOf(device, waveOps, waveSize)
  const half = halfPrecision && device.features.has('shader-f16')
  const waveKey = wave ? `wave ${wave.lanes}${wave.pinned ? ' pinned' : ''}` : 'plain'
  const key = half ? `${waveKey} f16` : waveKey
  execution = held.keyed.get(key)
  if (!execution) held.keyed.set(key, (execution = { wave, half, key }))
  held.asked.set(ask, execution)
  return execution
}

/** The execution of the settings' defaults (the reference's: wave operations on, the device's own
 *  size, 16-bit math on). */
export const defaultExecution = (device: GPUDevice) => taaExecutionOf(device, true, 0, true)

/** The execution of `device` as the session's settings ask. */
export const executionOf = (rt: Pick<WebgpuPagesRuntime, 'context'>, device: GPUDevice) =>
  taaExecutionOf(
    device,
    readTemporalSetting(rt, 'temporalWaveOps'),
    readTemporalSetting(rt, 'temporalWaveSize'),
    readTemporalSetting(rt, 'temporalHalfPrecision'),
  )

/** The texels a workgroup of the history update covers across and down: a tile of 8 across and,
 *  down, the lanes over 8 — 64 lanes for the plain 32-bit variant, 32 for the plain 16-bit one, a
 *  subgroup's for a wave one — times the pixels a lane takes, two in 16 bits (`resolveWgsl.ts`). */
export const updateTile = (execution: TaaExecution): readonly [number, number] => {
  const pixels = execution.half ? 2 : 1
  const lanes = execution.wave?.lanes ?? 64 / pixels
  return [8, (lanes / 8) * pixels]
}
