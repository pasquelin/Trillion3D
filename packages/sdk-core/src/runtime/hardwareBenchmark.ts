/**
 * The hardware benchmark's arithmetic, pure: the reference's tests, their times on the machine
 * whose index is 100, their weights, the robust value of a series of timings, the processor and
 * graphics indices, the level each quality group takes from them, and the result as it is kept.
 * The processor tests are `benchmarkProcessor.ts`; the browser runs the graphics tests
 * (`sdk-browser/src/session/world/hardwareBenchmark.ts`); everything that turns times into levels
 * is here, proved on the CPU.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { QUALITY_PRESETS, type QualityLevel } from './qualityLevels.ts'
import type { QualityGroup } from './renderSettings.ts'
import { seriesValue } from './benchmarkSeries.ts'

/** The work a run asks by default: ten runs of each processor test, and the graphics passes at ten
 *  times their base work. */
export const BENCHMARK_WORK_SCALE = 10
/** The most work a run asks: a whole number from 1 to this. */
const MAX_WORK_SCALE = 1000
/** Warm-up rounds of the graphics test, each at `GPU_WARMUP_WORK_SCALE` of the work. */
export const GPU_WARMUP_ROUNDS = 3
/** The share of the work a warm-up round asks. */
export const GPU_WARMUP_WORK_SCALE = 0.15
/** Seconds the last warm-up may take in all: past it, the full test is not run, lest the device
 *  hang. */
export const GPU_FULL_TEST_SECONDS = 1

/** One test: its time per unit of work on the machine whose index is 100, and its weight in the
 *  index. */
type BenchmarkMethod = {
  readonly name: string
  readonly indexTime: number
  readonly weight: number
}
/** A graphics test, drawn as pixels (`'pixel'`, a 512² rectangle per unit) or as vertices. */
type GpuBenchmarkMethod = BenchmarkMethod & { readonly kind: 'pixel' | 'vertex' }

/** The processor tests, in run order: seconds a run on the index machine. */
export const CPU_METHODS: readonly BenchmarkMethod[] = [
  { name: 'rayTriangle', indexTime: 0.02561, weight: 1 },
  { name: 'fractal', indexTime: 0.0286, weight: 1.5 },
]

/** The graphics tests, in draw order: seconds per billion pixels, or per billion vertices. The
 *  vertex tests weigh nothing: they are timed, and their time counts in the run's total. */
export const GPU_METHODS: readonly GpuBenchmarkMethod[] = [
  { name: 'aluNoise', indexTime: 1 / 4.601, weight: 1, kind: 'pixel' },
  { name: 'texture', indexTime: 1 / 7.447, weight: 0.1, kind: 'pixel' },
  { name: 'dependentTexture', indexTime: 1 / 3.847, weight: 0.1, kind: 'pixel' },
  { name: 'fill', indexTime: 1 / 25.463, weight: 3, kind: 'pixel' },
  { name: 'bandwidth', indexTime: 1 / 1.072, weight: 1, kind: 'pixel' },
  { name: 'vertexAttributes', indexTime: 1 / 1.537, weight: 0, kind: 'vertex' },
  { name: 'vertexId', indexTime: 1 / 1.767, weight: 0, kind: 'vertex' },
]

/** The graphics tests' sizes: the side of their square targets, the primitives of their base work
 *  and the vertices a vertex draw holds at most. */
export const GPU_BENCHMARK_RESOLUTION = 512
export const GPU_BENCHMARK_PRIMITIVES = 200_000
export const GPU_BENCHMARK_VERTICES = GPU_BENCHMARK_PRIMITIVES * 3
/** Iterations of every graphics test: iteration `i` asks `(i / 10 + 1)` times the work. */
export const GPU_BENCHMARK_ITERATIONS = 70

/** What a test measured: seconds in all, and seconds per unit of work; -1 both before a measure. */
export type BenchmarkMeasure = { total: number; normalized: number }
/** A test not measured. */
const UNMEASURED: BenchmarkMeasure = { total: -1, normalized: -1 }

/** Throws unless `workScale` is a whole number of work from 1 to `MAX_WORK_SCALE` and both
 *  multipliers are above 0. */
export function checkBenchmarkOptions(workScale: number, cpu: number, gpu: number) {
  const whole = Number.isInteger(workScale) && workScale >= 1 && workScale <= MAX_WORK_SCALE
  if (!whole || !(cpu > 0) || !(gpu > 0))
    throw new Error(
      `HARDWARE_BENCHMARK_OPTIONS: the work is a whole number from 1 to ${MAX_WORK_SCALE}, the multipliers above 0`,
    )
}

/** A test's index: 100 on the index machine, higher on a faster one. */
const perfIndex = (method: BenchmarkMethod, measure: BenchmarkMeasure) =>
  (100 * method.indexTime) / measure.normalized

/** The index of `methods` measured as `measures`: each test's index weighted by its share of the
 *  weights, and each test's own index (`steps`). */
export function weightedPerfIndex(
  methods: readonly BenchmarkMethod[],
  measures: readonly BenchmarkMeasure[],
) {
  const totalWeight = methods.reduce((sum, method) => sum + method.weight, 0)
  let index = 0
  const steps: number[] = []
  methods.forEach((method, i) => {
    const step = perfIndex(method, measures[i] ?? UNMEASURED)
    steps.push(step)
    index += step * (totalWeight > 0 ? method.weight / totalWeight : 0)
  })
  return { index, steps }
}

/** Seconds the measured graphics tests took in all; -1 counted for each test not measured. */
export const totalSeconds = (measures: readonly BenchmarkMeasure[]) =>
  measures.reduce((sum, measure) => sum + measure.total, 0)

/** The work iteration `iteration` asks of a run at `workScale`. */
export const iterationWorkScale = (iteration: number, workScale: number) =>
  Math.fround((Math.fround(iteration / 10) + 1) * workScale)

/** Units of work of one iteration of `method` at `scale`: billions of pixels or of vertices. */
const iterationUnits = (method: GpuBenchmarkMethod, scale: number) =>
  method.kind === 'vertex'
    ? (scale * GPU_BENCHMARK_VERTICES) / 1e9
    : (scale * GPU_BENCHMARK_RESOLUTION * GPU_BENCHMARK_RESOLUTION) / 1e9

/** Each test's measure from a run's timestamps (nanoseconds, read in whole microseconds: the
 *  reference's precision) and the work scale of each iteration: the first stamp closes the warm-up
 *  pass, and each test then holds two, its pass's start and end, so the passes' times never
 *  overlap (a tile-based device runs one pass's stages beside the next's). A test's time is the
 *  gap between its two, at least a microsecond, summed for its total and normalized per billion
 *  pixels or vertices for its series; a test whose series keeps no sample stays unmeasured. */
export function measuresOf(stamps: BigUint64Array, scales: readonly number[]): BenchmarkMeasure[] {
  const methods = GPU_METHODS.length
  const totals = GPU_METHODS.map(() => 0)
  const series = GPU_METHODS.map(() => [] as number[])
  for (let iteration = 0; iteration < scales.length; iteration++) {
    for (let method = 0; method < methods; method++) {
      const first = 1 + 2 * (iteration * methods + method)
      let elapsed = BigInt.asUintN(64, stamps[first + 1] / 1000n - stamps[first] / 1000n)
      if (elapsed < 1n) elapsed = 1n
      totals[method] += Number(elapsed)
      // The iteration's own time is kept in 32 bits.
      const seconds = Math.fround(Number(BigInt.asUintN(32, elapsed)) / 1_000_000)
      series[method].push(seconds / iterationUnits(GPU_METHODS[method], scales[iteration]))
    }
  }
  return series.map((values, method) => {
    const { value, confidence } = seriesValue(values)
    return confidence > 0 ? { total: totals[method] / 1_000_000, normalized: value } : UNMEASURED
  })
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

/** The step of the clock that wrote `stamps`, in whole microseconds, at least 1: the greatest
 *  common divisor of the gaps between them. A browser that rounds its timestamps (to 100 µs where
 *  no developer switch is set) writes every one a multiple of its step. */
export function timerStep(stamps: BigUint64Array) {
  let step = 0n
  for (let i = 1; i < stamps.length; i++) {
    const gap = stamps[i] > stamps[i - 1] ? stamps[i] - stamps[i - 1] : stamps[i - 1] - stamps[i]
    if (gap) step = gcd(gap, step)
  }
  return Math.max(1, ceilDiv(Number(step), 1000))
}

/** The work a run asks of the graphics tests on a clock of step `step` microseconds: `workScale`
 *  times the step, so that a step is as small a share of each pass as the reference's microsecond
 *  is at `workScale`, held to `MAX_WORK_SCALE`. */
export const steppedWorkScale = (workScale: number, step: number) =>
  Math.min(workScale * step, MAX_WORK_SCALE)

/** Which index a group reads: the graphics one, or the lower of the two. */
type PerfIndexKind = 'gpu' | 'min'
/** A group's row: the index it reads and the three thresholds from level 0 to 1, 1 to 2, 2 to 3. */
type PerfIndexRow = { kind: PerfIndexKind; thresholds: readonly [number, number, number] }

const GPU_ROW: PerfIndexRow = { kind: 'gpu', thresholds: [18, 42, 115] }
const MIN_ROW: PerfIndexRow = { kind: 'min', thresholds: [18, 42, 105] }

/** Each quality group's row. The indirect light reads the reference's global illumination row and
 *  its reflections' row, the same; the reference's foliage, shading and landscape groups have no
 *  group here. */
const PERF_INDEX_ROWS: Readonly<Record<QualityGroup, PerfIndexRow>> = {
  viewDistance: MIN_ROW,
  edgeSmoothing: GPU_ROW,
  shadows: MIN_ROW,
  indirectLight: GPU_ROW,
  imageEffects: GPU_ROW,
  textures: GPU_ROW,
  effects: MIN_ROW,
}

/** The level, 0 to 3, `row` gives the indices: the thresholds its index is not below. A row of kind
 *  `min` reads the lower of the two indices; without a processor index (`null`, no worker ran its
 *  tests) it reads the graphics one alone. */
function levelFromPerfIndex(row: PerfIndexRow, gpu: number, cpu: number | null) {
  const index = row.kind === 'min' && cpu !== null ? Math.min(cpu, gpu) : gpu
  let level = 0
  for (const threshold of row.thresholds) {
    if (index < threshold) break
    level++
  }
  return level
}

/** Each group's level the indices give: levels 0 to 3 are the
 *  presets `smooth` to `max`; the benchmark never gives `cinematic`. */
function benchmarkLevels(gpu: number, cpu: number | null) {
  const groups = Object.fromEntries(
    (Object.keys(PERF_INDEX_ROWS) as QualityGroup[]).map((group) => [
      group,
      QUALITY_PRESETS[levelFromPerfIndex(PERF_INDEX_ROWS[group], gpu, cpu)],
    ]),
  ) as Record<QualityGroup, QualityLevel>
  return { groups }
}

/** What a run found, as kept between visits: the indices (the processor one `null` where no worker
 *  ran its tests, the graphics one on a device with no GPU timestamps or with a test unmeasured),
 *  each test's own index, the work asked and the work the graphics tests ran at
 *  (`steppedWorkScale`), and the graphics multiplier. */
export type HardwareBenchmarkResult = {
  cpuIndex: number | null
  gpuIndex: number | null
  cpuSteps: number[]
  gpuSteps: number[]
  workScale: number
  gpuWorkScale: number
  gpuMultiplier: number
}

/** The levels a result gives, `null` without a graphics index: every group reads it. */
export const resultLevels = (result: HardwareBenchmarkResult) =>
  result.gpuIndex === null ? null : benchmarkLevels(result.gpuIndex, result.cpuIndex)

/** The version of the kept result: a change of the tests, their times or the thresholds raises it,
 *  and a result kept under another is measured again. */
const BENCHMARK_VERSION = 3

/** The adapter a result was measured on, as its key: another one is measured again. */
export const adapterKey = (info: {
  vendor: string
  architecture: string
  device: string
  description: string
}) => [info.vendor, info.architecture, info.device, info.description].join('|')

/** The result kept in `value` for adapter `adapter`: `null` unless it was written at this version,
 *  on that adapter, with indices that are numbers above 0 (or none). */
export function keptResult(value: unknown, adapter: string): HardwareBenchmarkResult | null {
  if (!value || typeof value !== 'object') return null
  const kept = value as { version?: unknown; adapter?: unknown; result?: unknown }
  if (kept.version !== BENCHMARK_VERSION || kept.adapter !== adapter) return null
  const r = (kept.result ?? {}) as Record<string, unknown>
  const index = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x) && x > 0)
  const numbers = (x: unknown) => Array.isArray(x) && x.every((n) => typeof n === 'number')
  const scale = (x: unknown) => Number.isInteger(x) && (x as number) >= 1
  if (!index(r.cpuIndex) || !index(r.gpuIndex) || !numbers(r.cpuSteps) || !numbers(r.gpuSteps))
    return null
  if (!scale(r.workScale) || !scale(r.gpuWorkScale) || !(Number(r.gpuMultiplier) > 0)) return null
  return kept.result as HardwareBenchmarkResult
}

/** What is kept of `result`, measured on `adapter`. */
export const keptRecord = (result: HardwareBenchmarkResult, adapter: string) => ({
  version: BENCHMARK_VERSION,
  adapter,
  result,
})
