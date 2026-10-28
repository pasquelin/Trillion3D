import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import { SHADOW_TIME_COUNTERS } from '../../../../sdk-core/src/modules/stats/counters.ts'
import { UNCLASSIFIED, type StatsGpuSample } from '../../../../sdk-core/src/modules/stats/report.ts'
import { WEBGPU_STAGES } from '../../diagnostic/stage/passDeclaration.ts'
import { gpuPassStageOf, passOwnMs } from '../../diagnostic/stage/mapping.ts'
import { trim, WINDOW_MS, type Cursor } from './frameSeries.ts'

/** The stage of each pass name, looked up once. */
const stageByPass = new Map<string, string | null>()
const stageOf = (name: string) => {
  let stage = stageByPass.get(name)
  if (stage === undefined) stageByPass.set(name, (stage = gpuPassStageOf(name) ?? null))
  return stage
}

/** The device's passes of one image, classified; `stages` (stage -> pass names seen) takes any new
 *  name, and `grew` tells whether it did. */
function classifyPasses(
  timings: NonNullable<FrameMetrics['gpuPassMs']>,
  stages: Map<string, Set<string>>,
) {
  const passes: StatsGpuSample['passes'][number][] = []
  let grew = false
  for (const pass of timings.passes) {
    const ms = passOwnMs(pass)
    if (ms === null) continue
    const stage = stageOf(pass.name)
    const key = stage ?? UNCLASSIFIED
    passes.push({ name: pass.name, stage, ms })
    let names = stages.get(key)
    if (!names) stages.set(key, (names = new Set()))
    if (!names.has(pass.name)) {
      names.add(pass.name)
      grew = true
    }
  }
  return { passes, grew }
}

/** The shadow counters' times of `metrics`, by field. */
function shadowTimes(metrics: FrameMetrics) {
  const shadowMs: Record<string, number> = {}
  for (const { field } of SHADOW_TIME_COUNTERS) {
    const value = metrics[field]
    if (typeof value === 'number') shadowMs[field] = value
  }
  return shadowMs
}

/**
 * The GPU samples of the last second, and the stage and pass lists they are seen under. A sample is
 * filed only when the device handed a new, whole one: with a device image time. The lists are sticky since the start, in first-seen order (stages in the GPU tab's
 * order, the unclassified last), so the rows do not come and go with the window. `shadows` files
 * the shadow counters' times beside the passes.
 */
export function gpuSamples(shadows: boolean) {
  const gpu: StatsGpuSample[] = [],
    seen: Cursor = { at: [], start: 0 },
    // Stage -> its pass names, both in first-seen order.
    stages = new Map<string, Set<string>>()
  let gpuStages: readonly string[] = [],
    gpuPassesSeen: Record<string, readonly string[]> = {},
    gpuFrame: number | undefined
  return {
    /** Files the sample of a new device image seen at `at`: its passes, classified, and the sticky lists. */
    file(metrics: FrameMetrics, at: number) {
      const timings = metrics.gpuPassMs
      if (!timings || timings.frame === gpuFrame) return
      gpuFrame = timings.frame
      // The spans overlap: their total is no image time, so without a device image time nothing is filed.
      const frameMs = metrics.gpuFrameMs
      if (frameMs == null) return
      const { passes, grew } = classifyPasses(timings, stages)
      if (grew) {
        gpuStages = [
          ...WEBGPU_STAGES.filter((stage) => stages.has(stage)),
          ...(stages.has(UNCLASSIFIED) ? [UNCLASSIFIED] : []),
        ]
        gpuPassesSeen = Object.fromEntries([...stages].map(([stage, names]) => [stage, [...names]]))
      }
      const shadowMs = shadows ? shadowTimes(metrics) : {}
      gpu.push({ frameMs, shadowMs, passes })
      seen.at.push(at)
    },
    /** Keeps the last second before `now`; the last sample stays even when older, so the GPU rows always have a total. */
    trim(now: number) {
      const before = now - WINDOW_MS
      trim(seen, Math.min(before, seen.at[seen.at.length - 1] ?? before), [gpu])
    },
    /** The window's samples. */
    window: () => gpu.slice(seen.start),
    /** Whether no sample was filed in the last second before `now`: the rows show the last one and say so. */
    stale(now: number) {
      const newest = seen.at[seen.at.length - 1]
      return newest === undefined || newest < now - WINDOW_MS
    },
    stages: () => gpuStages,
    passesSeen: () => gpuPassesSeen,
  }
}
