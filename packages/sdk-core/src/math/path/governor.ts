import {
  CLOCK_RESOLUTION_MS,
  NS_PER_MS,
  POOLED_CLOCK_STEPS,
  PooledTiming,
  SlidingMedian,
  estimateClockResolutionMs,
} from './slidingWindow.ts'
import {
  MATH_PATH_CONTRACT,
  type MathPath,
  type MathPathMetrics,
  type MathPathMode,
  type MathPathOperation,
} from './contracts.ts'

/**
 * Compute-path governor, generic and per NAMED operation: it knows neither boxes nor
 * matrices, only timed executions reported to it under a name.
 *
 * It arbitrates on the only quantity comparable across two batch sizes: duration per element. For
 * each name and each path it keeps a sliding median — the median, not the mean, because
 * a late frame or a garbage collection is an outlier, not a trend.
 *
 * It switches only when the other path is clearly and lastingly better, and it keeps
 * the other median fresh by playing it from time to time. A clock too coarse to time one execution
 * (no cross-origin isolation) times pooled batches instead (CPU-20, #919): consecutive executions of
 * a path are summed until they span `POOLED_CLOCK_STEPS` clock steps, and each pool is one sample.
 * On a fine clock every execution is its own sample, exactly as before. Only a clock that never
 * moves leaves it on the JavaScript path, the baseline.
 */

/** Minimum executions before any arbitration: under this number, a single value would make the median. */
export const PATH_MIN_SAMPLES = 5
/** Lead required of the other path. Below that, the gap is machine noise, not the code. */
const PATH_SWITCH_MARGIN = 0.2
/** Consecutive executions at that lead before switching: a burst, not an accident. */
export const PATH_SWITCH_RUNS = 5
/** One execution in that many plays the other path to refresh its median without costing a frame. */
export const PATH_EXPLORE_EVERY = 50

class Operation {
  readonly js = new SlidingMedian()
  readonly wasm = new SlidingMedian()
  /** Per path, the executions a coarse clock pools into one sample; `null` on a fine clock. */
  readonly pools: Record<MathPath, PooledTiming> | null
  path: MathPath | null = null
  runs = 0
  switches = 0
  elements = 0
  /** Consecutive executions where the other path held its lead. Reset to zero as soon as it yields. */
  lead = 0
  constructor(poolSpanMs: number | null) {
    this.pools =
      poolSpanMs === null
        ? null
        : { js: new PooledTiming(poolSpanMs), wasm: new PooledTiming(poolSpanMs) }
  }
  /** Drops both paths' pooled executions: a missing timer breaks the batch. */
  dropPools() {
    this.pools?.js.clear()
    this.pools?.wasm.clear()
  }
}

/** Picks, per batch operation, the faster of JavaScript and WebAssembly from measured times. */
export interface PathGovernor {
  /** Forces a path, or lets it choose. */
  setMode(mode: MathPathMode): void
  /** Declares what the host managed to load, and why if applicable. */
  setWasm(available: boolean, simd: boolean | null, reason: string | null): void
  /** The path to play for the next execution of this operation. */
  choose(operation: string): MathPath
  /** What an execution cost. `ms` at `null`: the timer is missing, the operation falls back. */
  observe(operation: string, path: MathPath, ms: number | null, elements: number): void
  /** What it measured and chose. */
  metrics(): MathPathMetrics
}

/** The path to play next: the current one, but the other once every `PATH_EXPLORE_EVERY` runs. */
function pathToPlay(operation: Operation): MathPath {
  const current = operation.path ?? 'wasm'
  // Passive exploration: the other path runs once every `PATH_EXPLORE_EVERY`, otherwise its
  // median would age until it described a machine that no longer exists.
  const other = current === 'js' ? 'wasm' : 'js'
  return operation.runs % PATH_EXPLORE_EVERY === PATH_EXPLORE_EVERY - 1 ? other : current
}

/** Counts one execution and files its sample; true when a sample reached the medians. */
function fold(operation: Operation, path: MathPath, ms: number | null, elements: number): boolean {
  operation.runs++
  if (elements <= 0) return false
  operation.elements += elements
  if (ms === null) {
    // A missing timer proves nothing: the operation falls back to JavaScript and stays there
    // as long as no timed execution has fed both medians.
    operation.path = 'js'
    operation.lead = 0
    operation.dropPools()
    return false
  }
  // A fine clock keeps one sample per execution, bit for bit (-0 included): no pool there.
  const sample = operation.pools
    ? operation.pools[path].add(ms, elements)
    : (ms * NS_PER_MS) / elements
  if (sample === null) return false
  operation[path].add(sample)
  operation.path ??= path
  return true
}

/** Switches the operation's path once the other one has led by the margin for enough runs. */
function arbitrate(operation: Operation) {
  const current = operation.path
  if (!current) return
  const other = current === 'js' ? 'wasm' : 'js'
  const currentMedian = operation[current].median()
  const otherMedian = operation[other].median()
  const enough =
    operation[current].count >= PATH_MIN_SAMPLES && operation[other].count >= PATH_MIN_SAMPLES
  if (!enough || currentMedian === null || otherMedian === null) return
  if (otherMedian < currentMedian * (1 - PATH_SWITCH_MARGIN)) operation.lead++
  else operation.lead = 0
  if (operation.lead >= PATH_SWITCH_RUNS) {
    operation.path = other
    operation.switches++
    operation.lead = 0
  }
}

/** What each named operation measured and chose. */
function readOperations(operations: ReadonlyMap<string, Operation>) {
  const readings: Record<string, MathPathOperation> = {}
  for (const [name, operation] of operations)
    readings[name] = {
      path: operation.path,
      jsNsPerElement: operation.js.median(),
      wasmNsPerElement: operation.wasm.median(),
      jsSamples: operation.js.count,
      wasmSamples: operation.wasm.count,
      switches: operation.switches,
      elements: operation.elements,
    }
  return readings
}

/**
 * A governor. `now` is used only to estimate the thread clock resolution: durations
 * themselves are timed by the caller and reported to `observe`.
 */
export function createPathGovernor(now: () => number, mode: MathPathMode = 'auto'): PathGovernor {
  const operations = new Map<string, Operation>()
  const resolution = estimateClockResolutionMs(now)
  const coarse = resolution === null || resolution > CLOCK_RESOLUTION_MS
  const poolSpanMs = coarse && resolution !== null ? resolution * POOLED_CLOCK_STEPS : null
  let chosen = mode
  let available = false
  let simd: boolean | null = null
  let cause: string | null = 'WebAssembly module not loaded'

  const stateOf = (name: string) => {
    let operation = operations.get(name)
    if (!operation) operations.set(name, (operation = new Operation(poolSpanMs)))
    return operation
  }
  /** Arbitration is possible only if both paths exist AND the clock moves: a coarse one is pooled. */
  const canArbitrate = () => chosen === 'auto' && available && resolution !== null

  function choose(name: string) {
    if (chosen !== 'auto') return available || chosen === 'js' ? chosen : 'js'
    if (!canArbitrate()) return 'js'
    return pathToPlay(stateOf(name))
  }

  function observe(name: string, path: MathPath, ms: number | null, elements: number) {
    const operation = stateOf(name)
    if (fold(operation, path, ms, elements) && canArbitrate()) arbitrate(operation)
  }

  function metrics(): MathPathMetrics {
    return {
      contract: MATH_PATH_CONTRACT,
      mode: chosen,
      wasmAvailable: available,
      wasmSimd: simd,
      clockResolutionMs: resolution,
      clockCoarse: coarse,
      unavailableReason: cause,
      operations: readOperations(operations),
    }
  }

  return {
    setMode: (next) => {
      chosen = next
    },
    setWasm: (loaded, simdActive, reason) => {
      available = loaded
      simd = simdActive
      cause = reason
    },
    choose,
    observe,
    metrics,
  }
}
