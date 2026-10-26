import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CPU_METHODS,
  GPU_METHODS,
  adapterKey,
  checkBenchmarkOptions,
  keptRecord,
  keptResult,
  measuresOf,
  resultLevels,
  steppedWorkScale,
  timerStep,
  weightedPerfIndex,
  type HardwareBenchmarkResult,
} from './hardwareBenchmark.ts'
import { runCpuMethod } from './benchmarkProcessor.ts'
import { seriesValue } from './benchmarkSeries.ts'

/** A result of indices `cpu` and `gpu`. */
const benchmarkResult = (cpu: number | null, gpu: number | null): HardwareBenchmarkResult => ({
  cpuIndex: cpu,
  gpuIndex: gpu,
  cpuSteps: [],
  gpuSteps: [],
  workScale: 10,
  gpuWorkScale: 10,
  gpuMultiplier: 1,
})

const levelsAt = (gpu: number, cpu: number | null = 200) => resultLevels(benchmarkResult(cpu, gpu))!

test('a group reads the graphics index against its three thresholds: 18, 42, then 115 or 105', () => {
  // A threshold reached moves the level up: an index below the first is level 0.
  const at = (gpu: number) => [levelsAt(gpu).groups.edgeSmoothing, levelsAt(gpu).groups.shadows]
  assert.deepEqual(at(17.9), ['smooth', 'smooth'])
  assert.deepEqual(at(18), ['balanced', 'balanced'])
  assert.deepEqual(at(41.9), ['balanced', 'balanced'])
  assert.deepEqual(at(42), ['fine', 'fine'])
  assert.deepEqual(at(104.9), ['fine', 'fine'])
  assert.deepEqual(at(105), ['fine', 'max'], 'the min rows reach the top at 105')
  assert.deepEqual(at(115), ['max', 'max'])
  // A row that reads the lower of the two indices holds a fast graphics index to a slow
  // processor's level (30: level 1); the graphics rows do not.
  assert.deepEqual(levelsAt(120, 30).groups, {
    viewDistance: 'balanced',
    edgeSmoothing: 'max',
    shadows: 'balanced',
    indirectLight: 'max',
    imageEffects: 'max',
    textures: 'max',
    effects: 'balanced',
  })
  assert.deepEqual(levelsAt(120, null).groups.viewDistance, 'max', 'no processor index')
  assert.equal('resolution' in levelsAt(10), false, 'the benchmark gives no resolution')
  assert.equal(resultLevels(benchmarkResult(200, null)), null, 'no graphics index, no level')
})

test('the indices are the tests’ indices weighted, 100 on the index machine', () => {
  const unmeasured = { total: -1, normalized: -1 }
  const at = (factor: number) => (method: { indexTime: number }) => ({
    total: 1,
    normalized: method.indexTime * factor,
  })
  assert.deepEqual(weightedPerfIndex(CPU_METHODS, CPU_METHODS.map(at(1))), {
    index: 100,
    steps: [100, 100],
  })
  // Twice slower on the fractal alone, which weighs 1.5 of 2.5.
  const half = weightedPerfIndex(CPU_METHODS, [at(1)(CPU_METHODS[0]), at(2)(CPU_METHODS[1])])
  assert.ok(Math.abs(half.index - (100 * 1 + 50 * 1.5) / 2.5) < 1e-9)
  // The vertex tests weigh nothing: their index is told, never counted.
  const gpu = weightedPerfIndex(
    GPU_METHODS,
    GPU_METHODS.map((method, i) => at(i >= 5 ? 0.01 : 1)(method)),
  )
  assert.ok(Math.abs(gpu.index - 100) < 1e-9)
  assert.ok(gpu.steps[5] > 9999)
  assert.ok(weightedPerfIndex(CPU_METHODS, [unmeasured, unmeasured]).index < 0, 'unmeasured: -1')
})

test('a series keeps the middle of its last two thirds, widened while its spread stays under half its mean', () => {
  assert.deepEqual(seriesValue(Array(70).fill(2)), { value: 2, confidence: 100 })
  // The first third, whatever it holds, is dropped; one outlier on top stops the widening at the
  // ninth window, which leaves the three highest of 47 out.
  const { value, confidence } = seriesValue([...Array(23).fill(1000), ...Array(46).fill(2), 50])
  assert.equal(value, 2)
  assert.equal(confidence, (100 * 42) / 47)
})

test('a run’s timestamps, a start and an end for each test, become each test’s seconds per billion pixels or vertices', () => {
  // Every pass of iteration i takes (i + 1) × 100 µs; the work of iteration i at a scale of 10 is
  // (i / 10 + 1) × 10: 512² pixels a unit for the five pixel tests, 600 000 vertices for the two
  // vertex tests. Iteration 69 alone is checked through the robust value's top window below.
  const scales = Array.from({ length: 70 }, (_, i) => Math.fround((Math.fround(i / 10) + 1) * 10))
  const stamps = [5_000_000_000n]
  for (let i = 0; i < 70; i++)
    for (let m = 0; m < 7; m++) {
      const start = stamps[stamps.length - 1] + 7_000n
      stamps.push(start, start + 100_000n)
    }
  const measures = measuresOf(new BigUint64Array(stamps), scales)
  // Each pass took 100 µs: per billion pixels at scale s, 1e-4 / (s × 262144 / 1e9) seconds.
  const pixel = (s: number) => 1e-4 / ((s * 262144) / 1e9)
  const vertex = (s: number) => 1e-4 / ((s * 600000) / 1e9)
  assert.ok(
    measures[0].normalized <= pixel(scales[23]) && measures[0].normalized >= pixel(scales[69]),
  )
  assert.ok(Math.abs(measures[5].normalized / measures[0].normalized - 262144 / 600000) < 1e-6)
  assert.equal(measures[0].total, 70 * 1e-4, '70 passes of 100 µs')
  assert.ok(vertex(10) < pixel(10))
  // A stamp that goes back wraps on 64 bits, as the reference's unsigned difference does.
  const back = [...stamps]
  back[2] = back[1] - 1000n
  assert.ok(measuresOf(new BigUint64Array(back), scales)[0].total > 1e6)
})

test('a clock’s step is the greatest common gap of its stamps, and the work grows by it', () => {
  const stepped = (step: bigint, gaps: bigint[]) =>
    timerStep(
      new BigUint64Array(
        gaps.reduce((all, gap) => [...all, all[all.length - 1] + gap * step], [7n * step]),
      ),
    )
  assert.equal(stepped(100_000n, [0n, 3n, 1n, 0n, 7n]), 100, 'a browser that rounds to 100 µs')
  assert.equal(stepped(1n, [1234n, 977n, 50021n]), 1, 'nanoseconds: the reference’s microsecond')
  assert.equal(steppedWorkScale(10, 100), 1000)
  assert.equal(steppedWorkScale(10, 1), 10)
  assert.equal(steppedWorkScale(20, 100), 1000, 'held to the most work a run asks')
})

test('a run asks a whole work from 1 to 1000 and multipliers above 0', () => {
  checkBenchmarkOptions(10, 1, 1)
  for (const [work, cpu, gpu] of [
    [1.5, 1, 1],
    [0, 1, 1],
    [1001, 1, 1],
    [10, 0, 1],
    [10, 1, -1],
  ])
    assert.throws(() => checkBenchmarkOptions(work, cpu, gpu), /HARDWARE_BENCHMARK_OPTIONS/)
})

test('a kept result is read back on its own adapter, at its version, its indices above 0', () => {
  const adapter = adapterKey({ vendor: 'v', architecture: 'a', device: 'd', description: 'x' })
  const kept = keptRecord(benchmarkResult(40, 90), adapter)
  assert.deepEqual(keptResult(kept, adapter), benchmarkResult(40, 90))
  assert.equal(keptResult(kept, 'v|a|d|other'), null, 'another adapter measures again')
  assert.equal(keptResult({ ...kept, version: kept.version + 1 }, adapter), null)
  assert.equal(keptResult(keptRecord(benchmarkResult(40, -3), adapter), adapter), null)
  assert.equal(
    keptResult(keptRecord({ ...benchmarkResult(40, 90), workScale: 2.5 }, adapter), adapter),
    null,
  )
  assert.deepEqual(
    keptResult(keptRecord(benchmarkResult(null, null), adapter), adapter)?.gpuIndex,
    null,
  )
  assert.equal(keptResult('garbage', adapter), null)
})

test('the processor tests find what the reference’s own build finds', () => {
  let clock = 0
  const tick = () => (clock += 10)
  const ray = runCpuMethod(0, 1, tick)
  assert.deepEqual([ray.total, ray.normalized], [0.01, 0.01], 'one run, timed alone')
  assert.ok(Math.abs(ray.found - 0.037295) < 1e-12, 'the native build’s hit rate, 0.0372949988')
  const fractal = runCpuMethod(1, 2.7, tick)
  assert.deepEqual([fractal.total, fractal.normalized], [0.02, 0.01], '2.7 runs are 2')
  // The mean of the iterations is the native 76.5589, plus a random share under 1 a run.
  assert.ok(fractal.found / 2 >= 76.5589 && fractal.found / 2 < 77.5589, String(fractal.found))
})
