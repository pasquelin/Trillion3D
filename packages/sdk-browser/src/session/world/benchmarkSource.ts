import {
  adapterKey,
  keptRecord,
  keptResult,
  type HardwareBenchmarkResult,
} from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import { families } from '../host/families.ts'

/** What a run of the hardware benchmark asks: its work, a whole number from 1 to 1000 (10 by
 *  default: ten runs of each processor test, and graphics passes at ten times their base work, a
 *  few seconds of the device's work), and the factors the processor and graphics indices are
 *  multiplied by (1 by default). */
export interface HardwareBenchmarkOptions {
  workScale?: number
  cpuMultiplier?: number
  gpuMultiplier?: number
}

/** Where the world's quality finds the benchmark: the result kept for the world's adapter, and a
 *  run, which keeps what it finds. */
export type QualityBenchmark = {
  saved(): Promise<HardwareBenchmarkResult | null>
  run(options?: HardwareBenchmarkOptions): Promise<HardwareBenchmarkResult>
}

/** What a result is kept in: the origin's local storage where the page grants it. */
type ResultStore = Pick<Storage, 'getItem' | 'setItem'>

/** Where a result is kept between visits, under this key: one record, its version and adapter
 *  with it (`keptRecord`). */
const STORE = 'trillion3d.hardwareBenchmark'

/** The page's local storage, `null` where it has none or refuses it. */
function pageStore(): ResultStore | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The run, from its own family (`families.benchmark`): a page that never asks downloads none. */
const loadRun = () => families.benchmark.load().then((module) => module.runHardwareBenchmark)

/**
 * The page's benchmark for a world drawing on `device` (`undefined` while none is granted), stopped
 * by `signal` when the world is disposed. `saved` reads the result kept for the device's adapter;
 * `run` waits for the device's work to finish — the reference flushes its renderer first —, runs the
 * benchmark (one run at a time) and keeps its result for that adapter. A store the page refuses keeps
 * nothing.
 */
function pageBenchmark(
  device: () => Promise<GPUDevice | undefined>,
  signal: AbortSignal,
  store: () => ResultStore | null = pageStore,
  load = loadRun,
): QualityBenchmark {
  let running: Promise<HardwareBenchmarkResult> | null = null
  const run = async (options?: HardwareBenchmarkOptions) => {
    await (await device())?.queue.onSubmittedWorkDone()
    const { result, adapter } = await (await load())(options, signal)
    try {
      store()?.setItem(STORE, JSON.stringify(keptRecord(result, adapter)))
    } catch {
      /* A store that refuses the record keeps nothing: the next visit measures again. */
    }
    return result
  }
  return {
    async saved() {
      const drawing = await device()
      if (!drawing || signal.aborted) return null
      try {
        return keptResult(
          JSON.parse(store()?.getItem(STORE) ?? 'null'),
          adapterKey(drawing.adapterInfo),
        )
      } catch {
        return null
      }
    },
    run(options) {
      running ??= run(options).finally(() => (running = null))
      return running
    },
  }
}

/** The benchmark of a world drawing on the device `device` holds (`device.ts`): it reads that
 *  device's adapter once the grant asked last settles; `store` and `load` stand for the page's. */
export const worldBenchmark =
  (
    device: { readonly pending: Promise<unknown>; readonly gpuDevice: GPUDevice | undefined },
    store = pageStore,
    load = loadRun,
  ) =>
  (signal: AbortSignal) =>
    pageBenchmark(
      () =>
        device.pending.then(
          () => device.gpuDevice,
          () => undefined,
        ),
      signal,
      store,
      load,
    )
