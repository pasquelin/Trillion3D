import { CLOCK_RESOLUTION_MS, SlidingMedian, estimateClockResolutionMs } from './slidingWindow.ts';
import {
  MATH_PATH_CONTRACT,
  type MathPath,
  type MathPathMetrics,
  type MathPathMode,
  type MathPathOperation,
} from './contracts.ts';

/**
 * Compute-path governor, generic and per NAMED operation: it knows neither boxes nor
 * matrices, only timed executions reported to it under a name.
 *
 * It arbitrates on the only quantity comparable across two batch sizes: duration per element. For
 * each name and each path it keeps a sliding median — the median, not the mean, because
 * a late frame or a garbage collection is an outlier, not a trend.
 *
 * It switches only when the other path is clearly and lastingly better, and it keeps
 * the other median fresh by playing it from time to time. Without a fine enough clock, it does not
 * arbitrate at all: it stays on the JavaScript path, which is the reference.
 */

/** Minimum executions before any arbitration: under this number, a single value would make the median. */
export const PATH_MIN_SAMPLES = 5;
/** Lead required of the other path. Below that, the gap is machine noise, not the code. */
const PATH_SWITCH_MARGIN = 0.2;
/** Consecutive executions at that lead before switching: a burst, not an accident. */
export const PATH_SWITCH_RUNS = 5;
/** One execution in that many plays the other path to refresh its median without costing a frame. */
export const PATH_EXPLORE_EVERY = 50;

const NS_PER_MS = 1e6;

class Operation {
  readonly js = new SlidingMedian();
  readonly wasm = new SlidingMedian();
  path: MathPath | null = null;
  runs = 0;
  switches = 0;
  elements = 0;
  /** Consecutive executions where the other path held its lead. Reset to zero as soon as it yields. */
  lead = 0;
}

/** Picks, per batch operation, the faster of JavaScript and WebAssembly from measured times. */
export interface PathGovernor {
  /** Forces a path, or lets it choose. */
  setMode(mode: MathPathMode): void;
  /** Declares what the host managed to load, and why if applicable. */
  setWasm(available: boolean, simd: boolean | null, reason: string | null): void;
  /** The path to play for the next execution of this operation. */
  choose(operation: string): MathPath;
  /** What an execution cost. `ms` at `null`: the timer is missing, the operation falls back. */
  observe(operation: string, path: MathPath, ms: number | null, elements: number): void;
  /** What it measured and chose. */
  metrics(): MathPathMetrics;
}

/**
 * A governor. `now` is used only to estimate the thread clock resolution: durations
 * themselves are timed by the caller and reported to `observe`.
 */
export function createPathGovernor(now: () => number, mode: MathPathMode = 'auto'): PathGovernor {
  const operations = new Map<string, Operation>();
  const resolution = estimateClockResolutionMs(now);
  const coarse = resolution === null || resolution > CLOCK_RESOLUTION_MS;
  let chosen = mode;
  let available = false;
  let simd: boolean | null = null;
  let cause: string | null = 'WebAssembly module not loaded';

  const stateOf = (name: string) => {
    let operation = operations.get(name);
    if (!operation) operations.set(name, (operation = new Operation()));
    return operation;
  };
  /** Arbitration is possible only if both paths exist AND the clock can tell them apart. */
  const canArbitrate = () => chosen === 'auto' && available && !coarse;

  function choose(name: string) {
    if (chosen !== 'auto') return available || chosen === 'js' ? chosen : 'js';
    if (!canArbitrate()) return 'js';
    const operation = stateOf(name);
    const current = operation.path ?? 'wasm';
    // Passive exploration: the other path runs once every `PATH_EXPLORE_EVERY`, otherwise its
    // median would age until it described a machine that no longer exists.
    const other = current === 'js' ? 'wasm' : 'js';
    return operation.runs % PATH_EXPLORE_EVERY === PATH_EXPLORE_EVERY - 1 ? other : current;
  }

  function observe(name: string, path: MathPath, ms: number | null, elements: number) {
    const operation = stateOf(name);
    operation.runs++;
    if (elements <= 0) return;
    operation.elements += elements;
    if (ms === null) {
      // A missing timer proves nothing: the operation falls back to the reference and stays there
      // as long as no timed execution has fed both medians.
      operation.path = 'js';
      operation.lead = 0;
      return;
    }
    operation[path].add((ms * NS_PER_MS) / elements);
    operation.path ??= path;
    if (!canArbitrate()) return;
    const current = operation.path;
    const other = current === 'js' ? 'wasm' : 'js';
    const currentMedian = operation[current].median();
    const otherMedian = operation[other].median();
    const enough =
      operation[current].count >= PATH_MIN_SAMPLES && operation[other].count >= PATH_MIN_SAMPLES;
    if (!enough || currentMedian === null || otherMedian === null) return;
    if (otherMedian < currentMedian * (1 - PATH_SWITCH_MARGIN)) operation.lead++;
    else operation.lead = 0;
    if (operation.lead >= PATH_SWITCH_RUNS) {
      operation.path = other;
      operation.switches++;
      operation.lead = 0;
    }
  }

  function metrics(): MathPathMetrics {
    const readings: Record<string, MathPathOperation> = {};
    for (const [name, operation] of operations)
      readings[name] = {
        path: operation.path,
        jsNsPerElement: operation.js.median(),
        wasmNsPerElement: operation.wasm.median(),
        jsSamples: operation.js.count,
        wasmSamples: operation.wasm.count,
        switches: operation.switches,
        elements: operation.elements,
      };
    return {
      contract: MATH_PATH_CONTRACT,
      mode: chosen,
      wasmAvailable: available,
      wasmSimd: simd,
      clockResolutionMs: resolution,
      clockCoarse: coarse,
      unavailableReason: cause,
      operations: readings,
    };
  }

  return {
    setMode: (next) => {
      chosen = next;
    },
    setWasm: (loaded, simdActive, reason) => {
      available = loaded;
      simd = simdActive;
      cause = reason;
    },
    choose,
    observe,
    metrics,
  };
}
