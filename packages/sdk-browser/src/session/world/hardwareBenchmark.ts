import {
  BENCHMARK_WORK_SCALE,
  CPU_METHODS,
  GPU_FULL_TEST_SECONDS,
  GPU_METHODS,
  GPU_WARMUP_ROUNDS,
  GPU_WARMUP_WORK_SCALE,
  checkBenchmarkOptions,
  steppedWorkScale,
  timerStep,
  totalSeconds,
  weightedPerfIndex,
  type BenchmarkMeasure,
  type HardwareBenchmarkResult,
} from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import { probeWorldDevice } from '../../api/capability/worldReady.ts'
import { gpuCapsOf } from '../../gpu/core/gpuCaps.ts'
import { createGpuBenchmark } from '../../gpu/benchmark/gpuBenchmark.ts'
import { besideModule, startModuleWorker } from '../host/besideModule.ts'
import type { HardwareBenchmarkOptions } from './benchmarkSource.ts'

/** What a run starts: the processor tests' worker and the graphics tests' own device. */
type BenchmarkNeeds = { worker(): Worker; device(): Promise<GPUDevice> }

/** The page's: the worker module beside this one, and a device asked the way a world asks its own. */
const PAGE_NEEDS: BenchmarkNeeds = {
  worker: () => startModuleWorker(besideModule('benchmarkWorker', import.meta.url)),
  device: probeWorldDevice,
}

const f = Math.fround

/** One run of processor test `method` in `worker`: its seconds; refused if the worker fails or the
 *  run is stopped. */
function processorRun(worker: Worker, method: number, signal?: AbortSignal) {
  return new Promise<number>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const failed = (event: Event) => {
      event.preventDefault()
      reject(new Error('HARDWARE_BENCHMARK_WORKER: the processor tests did not run'))
    }
    worker.onmessage = (event) => resolve((event.data as { total: number }).total)
    worker.onerror = failed
    worker.onmessageerror = failed
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    worker.postMessage(method)
  })
}

/** The processor index at `workScale`: each test run `workScale` times in the worker, in order;
 *  `null` where the worker does not run, which no level reads. */
async function measureProcessor(workScale: number, start: () => Worker, signal?: AbortSignal) {
  let worker: Worker
  try {
    worker = start()
  } catch {
    return null
  }
  try {
    const measures: BenchmarkMeasure[] = []
    for (let method = 0; method < CPU_METHODS.length; method++) {
      let total = 0
      for (let run = 0; run < workScale; run++) total += await processorRun(worker, method, signal)
      measures.push({ total, normalized: total / workScale })
    }
    return weightedPerfIndex(CPU_METHODS, measures)
  } catch (error) {
    if (signal?.aborted) throw error
    return null
  } finally {
    worker.terminate()
  }
}

/**
 * The graphics index on `device`: a first round at 15 % of `workScale` reads the step of the
 * device's clock (`timerStep`), and the work is scaled by it (`steppedWorkScale`); then three warm-up
 * rounds at 15 % of that work, and the full test if the last took under a second in all. `null` on
 * a device with no GPU timestamps, which times nothing.
 */
async function measureGraphics(workScale: number, device: GPUDevice, signal?: AbortSignal) {
  if (!gpuCapsOf(device).timestamp) return null
  const benchmark = await createGpuBenchmark(device)
  try {
    const warmup = (scale: number) => f(scale * f(GPU_WARMUP_WORK_SCALE))
    const probe = await benchmark.run(warmup(workScale))
    const scale = steppedWorkScale(workScale, timerStep(probe.stamps))
    let measures = probe.measures,
      seconds = totalSeconds(measures)
    for (let round = 0; round < GPU_WARMUP_ROUNDS; round++) {
      signal?.throwIfAborted()
      measures = (await benchmark.run(warmup(scale))).measures
      seconds = totalSeconds(measures)
    }
    signal?.throwIfAborted()
    if (seconds < GPU_FULL_TEST_SECONDS) measures = (await benchmark.run(scale)).measures
    return { ...weightedPerfIndex(GPU_METHODS, measures), scale }
  } finally {
    benchmark.destroy()
  }
}

/**
 * Runs the hardware benchmark — the processor tests in a worker, then the graphics tests on a device
 * of their own, given back after — and answers its result with the adapter it measured. `signal`
 * stops it: the worker and the device are given back and the run is refused.
 */
export async function runHardwareBenchmark(
  options: HardwareBenchmarkOptions = {},
  signal?: AbortSignal,
  needs: BenchmarkNeeds = PAGE_NEEDS,
): Promise<{ result: HardwareBenchmarkResult; adapter: string | undefined }> {
  const { workScale = BENCHMARK_WORK_SCALE, cpuMultiplier = 1, gpuMultiplier = 1 } = options
  checkBenchmarkOptions(workScale, cpuMultiplier, gpuMultiplier)
  const processor = await measureProcessor(workScale, needs.worker, signal)
  signal?.throwIfAborted()
  const device = await needs.device()
  try {
    signal?.throwIfAborted()
    const graphics = await measureGraphics(workScale, device, signal)
    const result: HardwareBenchmarkResult = {
      cpuIndex: processor ? processor.index * cpuMultiplier : null,
      // An index at or below 0 — a test unmeasured — is no measure: no level is read from it.
      gpuIndex: graphics && graphics.index > 0 ? graphics.index * gpuMultiplier : null,
      cpuSteps: processor?.steps ?? [],
      gpuSteps: graphics?.steps ?? [],
      workScale,
      gpuWorkScale: graphics?.scale ?? workScale,
      gpuMultiplier,
    }
    return { result, adapter: gpuCapsOf(device).adapter }
  } finally {
    device.destroy()
  }
}
