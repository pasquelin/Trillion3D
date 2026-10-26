import type { QualityGroup } from '../../../../sdk-core/src/runtime/renderSettings.ts'
import type { QualityLevel } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import {
  resultLevels,
  type HardwareBenchmarkResult,
} from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import type { HardwareBenchmarkOptions, QualityBenchmark } from './benchmarkSource.ts'

/** What the benchmark found on this machine (`world.quality.hardware`): the indices, each test's
 *  own index, the work, and what they give — each group's level, `null` without a graphics
 *  index. */
export type QualityHardware = HardwareBenchmarkResult & {
  groups: Record<QualityGroup, QualityLevel> | null
}

/** No benchmark: nothing kept, and a run refused. */
export const NO_BENCHMARK: QualityBenchmark = {
  saved: () => Promise.resolve(null),
  run: () => Promise.reject(new Error('HARDWARE_BENCHMARK_UNAVAILABLE: this world runs none')),
}

/** Resolves when the page is idle (at most 5 s later), after the load's own work. */
const idle = () =>
  new Promise<void>((resolve) =>
    typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => resolve(), { timeout: 5000 })
      : setTimeout(resolve, 1000),
  )

/**
 * The world quality's hold on the hardware benchmark `benchmark`: the result it knows, read from
 * what is kept once `auto` is asked (`look`) or found by a run the page asks, or by the one run
 * `look` starts, at idle, where nothing is kept for the adapter; `found` is told each time it
 * learns one.
 */
export function qualityHardware(benchmark: QualityBenchmark, found: () => void) {
  let result: HardwareBenchmarkResult | null = null,
    looked: Promise<void> | undefined
  const view = (): QualityHardware | null => {
    if (!result) return null
    const given = resultLevels(result)
    return { ...result, groups: given?.groups ?? null }
  }
  return {
    /** The levels the known result gives, `null` without one. */
    levels: () => (result ? resultLevels(result) : null),
    /** Reads, once, the result kept for the world's adapter; where none is kept, runs the
     *  benchmark once when the page is idle, never in a frame, and keeps it for the adapter. */
    look() {
      looked ??= benchmark
        .saved()
        .then(async (kept) => {
          if (result) return
          if (!kept) {
            await idle()
            if (result) return
            kept = await benchmark.run()
          }
          result = kept
          found()
        })
        .catch(() => {})
    },
    /** The page's members: the result, and a run; `chosen` is told once a run's result is known. */
    accessors: (chosen: () => void) => ({
      /** What the hardware benchmark found on this machine, kept from an earlier visit on this
       *  adapter or found by the last run (`QualityHardware`); `null` before any. */
      get hardware(): QualityHardware | null {
        return view()
      },
      /** Runs the hardware benchmark, keeps its result for this adapter and draws it: the preset
       *  becomes `'auto'`. Answers what it found. */
      async benchmark(asked?: HardwareBenchmarkOptions): Promise<QualityHardware> {
        result = await benchmark.run(asked)
        chosen()
        return view()!
      },
    }),
  }
}
