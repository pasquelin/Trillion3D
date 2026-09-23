import type { MathPathMetrics, MathPathMode } from '../sdk-core/src/index.ts';
import { createPathGovernor, type PathGovernor } from '../sdk-core/src/index.ts';
import { prepareSdkWasm, type SdkWasm } from './geometryPageWasm.ts';
import { WASM_ARENA_CONTRACT } from './wasmArena.ts';

/**
 * Session state for batch math: governor, WebAssembly module, availability decision.
 * Everything else — the batches themselves — is in `mathBatchRuntime.ts`.
 *
 * Module is the SDK one, already loaded for page decoding: no second instantiation,
 * no second linear memory. If missing, if compute contract does not match what this
 * loader expects, or if thread clock is too coarse to decide between paths, everything
 * remains on JavaScript path and the reason is published — never a silent fallback.
 */

/** Thread clock. `performance.now()` where available, otherwise sole available clock. */
export function mathClock() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

let gouverneur: PathGovernor | null = null;
let module: SdkWasm | null = null;
let attente: Promise<void> | null = null;

/** Session governor, created on first demand. */
export function mathGovernor(): PathGovernor {
  gouverneur ??= createPathGovernor(mathClock);
  return gouverneur;
}

/**
 * Loads module once for session and declares what is playable to governor. `mode`
 * forces path for a campaign (`'js'` or `'wasm'`) or lets measurement decide (`'auto'`).
 */
export function prepareMathBatch(mode: MathPathMode): Promise<void> {
  mathGovernor().setMode(mode);
  return loadMathBatch();
}

/** Module, loaded once for session; governor mode does not modify it. */
export function loadMathBatch(): Promise<void> {
  const g = mathGovernor();
  attente ??= (async () => {
    const wasm = await prepareSdkWasm();
    if (!wasm) return g.setWasm(false, null, 'WebAssembly module unavailable');
    const contrat = typeof wasm.math_contract === 'function' ? wasm.math_contract() : 0;
    if (contrat !== WASM_ARENA_CONTRACT)
      return g.setWasm(
        false,
        null,
        `computation contract ${contrat}; this loader expects ${WASM_ARENA_CONTRACT}`,
      );
    module = wasm;
    g.setWasm(true, wasm.math_simd() === 1, null);
  })();
  return attente;
}

/** Usable module for batches, or `null` while WebAssembly path is unopened. */
export function mathBatchWasm(): SdkWasm | null {
  return module;
}

/** State published in metrics and capabilities. */
export function mathBatchMetrics(): MathPathMetrics {
  return mathGovernor().metrics();
}
