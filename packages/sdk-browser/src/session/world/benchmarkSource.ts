import {
  keptRecord,
  keptResult,
  type HardwareBenchmarkResult,
} from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import { gpuCapsOf } from '../../gpu/core/gpuCaps.ts'
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

/**
 * The store of a page's results: what the page keeps in memory — the same source for every world of the page — and, where it has one, in its local storage, which survives the
 * visit. A result is read from the local storage when it holds one, else from the memory; a local storage that is absent, refuses or is full (a private window, a quota)
 * leaves the memory, so a second world never measures again. `createPageStore` makes one with a memory of its own, which a test isolates.
 */
export function createPageStore(): () => ResultStore {
  const memory = new Map<string, string>()
  const store: ResultStore = {
    getItem(key) {
      try {
        const kept = globalThis.localStorage?.getItem(key)
        if (kept != null) return kept
      } catch {
        /* No local storage to read: the memory answers. */
      }
      return memory.get(key) ?? null
    },
    setItem(key, value) {
      memory.set(key, value)
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        /* Kept in memory alone: the next visit measures again. */
      }
    },
  }
  return () => store
}

/** The page's own store, shared by its worlds. */
const pageStore = createPageStore()

/** The runs in flight, by adapter: shared by every world of the page. */
const measuring = new Map<string, Promise<HardwareBenchmarkResult>>()

/** The run, from its own family (`families.benchmark`): a page that never asks downloads none. */
const loadRun = () => families.benchmark.load().then((module) => module.runHardwareBenchmark)

/**
 * The page's benchmark for a world drawing on `device` (`undefined` while none is granted), stopped
 * by `signal` when the world is disposed. `saved` reads the result kept for the device's adapter;
 * `run` waits for the device's work to finish — the reference flushes its renderer first —, runs the
 * benchmark (one run at a time) and keeps its result for that adapter (`createPageStore`). A store the caller hands in and refuses keeps nothing.
 */
function pageBenchmark(
  device: () => Promise<GPUDevice | undefined>,
  signal: AbortSignal,
  store: () => ResultStore | null = pageStore,
  load = loadRun,
): QualityBenchmark {
  const run = async (options?: HardwareBenchmarkOptions) => {
    await (await device())?.queue.onSubmittedWorkDone()
    const { result, adapter } = await (await load())(options, signal)
    // An adapter the device does not state is kept for none: it could be any other one (`GpuCaps.adapter`).
    if (adapter === undefined) return result
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
      // No result is read for an adapter the device does not state: it would be every unknown adapter's.
      const { adapter } = gpuCapsOf(drawing)
      if (adapter === undefined) return null
      try {
        return keptResult(JSON.parse(store()?.getItem(STORE) ?? 'null'), adapter)
      } catch {
        return null
      }
    },
    async run(options) {
      // One run at a time for an adapter, whichever world asks: a second world meets the first one's.
      const drawing = await device()
      const key = (drawing && gpuCapsOf(drawing).adapter) || ''
      let running = measuring.get(key)
      if (!running) {
        running = run(options).finally(() => measuring.delete(key))
        measuring.set(key, running)
      }
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
