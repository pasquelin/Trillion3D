import { CLOCK_RESOLUTION_MS, Fenetre, estimateClockResolutionMs } from './mathPathWindow.ts';
import {
  MATH_PATH_CONTRACT,
  type MathPath,
  type MathPathMetrics,
  type MathPathMode,
  type MathPathOperation,
} from './mathPathContracts.ts';

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

const NS_PAR_MS = 1e6;

class Operation {
  readonly js = new Fenetre();
  readonly wasm = new Fenetre();
  path: MathPath | null = null;
  runs = 0;
  switches = 0;
  elements = 0;
  /** Consecutive executions where the other path held its lead. Reset to zero as soon as it yields. */
  avance = 0;
}

export interface PathGovernor {
  setMode(mode: MathPathMode): void;
  /** Declares what the host managed to load, and why if applicable. */
  setWasm(available: boolean, simd: boolean | null, reason: string | null): void;
  /** The path to play for the next execution of this operation. */
  choose(operation: string): MathPath;
  /** What an execution cost. `ms` at `null`: the timer is missing, the operation falls back. */
  observe(operation: string, path: MathPath, ms: number | null, elements: number): void;
  metrics(): MathPathMetrics;
}

/**
 * A governor. `now` is used only to estimate the thread clock resolution: durations
 * themselves are timed by the caller and reported to `observe`.
 */
export function createPathGovernor(now: () => number, mode: MathPathMode = 'auto'): PathGovernor {
  const operations = new Map<string, Operation>();
  const resolution = estimateClockResolutionMs(now);
  const grossiere = resolution === null || resolution > CLOCK_RESOLUTION_MS;
  let choisi = mode;
  let disponible = false;
  let simd: boolean | null = null;
  let cause: string | null = 'WebAssembly module not loaded';

  const etat = (nom: string) => {
    let operation = operations.get(nom);
    if (!operation) operations.set(nom, (operation = new Operation()));
    return operation;
  };
  /** Arbitration is possible only if both paths exist AND the clock can tell them apart. */
  const arbitrable = () => choisi === 'auto' && disponible && !grossiere;

  function choose(nom: string) {
    if (choisi !== 'auto') return disponible || choisi === 'js' ? choisi : 'js';
    if (!arbitrable()) return 'js';
    const operation = etat(nom);
    const courant = operation.path ?? 'wasm';
    // Passive exploration: the other path runs once every `PATH_EXPLORE_EVERY`, otherwise its
    // median would age until it described a machine that no longer exists.
    const autre = courant === 'js' ? 'wasm' : 'js';
    return operation.runs % PATH_EXPLORE_EVERY === PATH_EXPLORE_EVERY - 1 ? autre : courant;
  }

  function observe(nom: string, path: MathPath, ms: number | null, elements: number) {
    const operation = etat(nom);
    operation.runs++;
    if (elements <= 0) return;
    operation.elements += elements;
    if (ms === null) {
      // A missing timer proves nothing: the operation falls back to the reference and stays there
      // as long as no timed execution has fed both medians.
      operation.path = 'js';
      operation.avance = 0;
      return;
    }
    operation[path].ajoute((ms * NS_PAR_MS) / elements);
    operation.path ??= path;
    if (!arbitrable()) return;
    const courant = operation.path;
    const autre = courant === 'js' ? 'wasm' : 'js';
    const iciMediane = operation[courant].mediane();
    const laMediane = operation[autre].mediane();
    const assez =
      operation[courant].count >= PATH_MIN_SAMPLES && operation[autre].count >= PATH_MIN_SAMPLES;
    if (!assez || iciMediane === null || laMediane === null) return;
    if (laMediane < iciMediane * (1 - PATH_SWITCH_MARGIN)) operation.avance++;
    else operation.avance = 0;
    if (operation.avance >= PATH_SWITCH_RUNS) {
      operation.path = autre;
      operation.switches++;
      operation.avance = 0;
    }
  }

  function metrics(): MathPathMetrics {
    const releve: Record<string, MathPathOperation> = {};
    for (const [nom, operation] of operations)
      releve[nom] = {
        path: operation.path,
        jsNsPerElement: operation.js.mediane(),
        wasmNsPerElement: operation.wasm.mediane(),
        jsSamples: operation.js.count,
        wasmSamples: operation.wasm.count,
        switches: operation.switches,
        elements: operation.elements,
      };
    return {
      contract: MATH_PATH_CONTRACT,
      mode: choisi,
      wasmAvailable: disponible,
      wasmSimd: simd,
      clockResolutionMs: resolution,
      clockCoarse: grossiere,
      unavailableReason: cause,
      operations: releve,
    };
  }

  return {
    setMode: (valeur) => {
      choisi = valeur;
    },
    setWasm: (available, simdActif, raison) => {
      disponible = available;
      simd = simdActif;
      cause = raison;
    },
    choose,
    observe,
    metrics,
  };
}
