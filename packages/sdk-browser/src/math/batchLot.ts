import type { MathPath } from '../../../sdk-core/src/index.ts';
import type { SdkWasm } from '../page/decode/geometryPageWasm.ts';
import { mathClock, mathBatchWasm, mathGovernor, loadMathBatch } from './batchState.ts';
import {
  blocsJavaScript,
  reserveArena,
  type ArenaBloc,
  type ArenaRequest,
} from '../page/decode/wasmArena.ts';

/**
 * What all math batches share: buffer, timed execution, and interface shape.
 * The batches themselves are in `batchRuntime.ts`.
 *
 * A batch is a BUFFER, not a function call: caller reserves blocks once, writes inputs
 * directly into returned views, calls `run()` as many times as needed, then releases buffer.
 * Nothing is copied between JavaScript and WebAssembly — same memory when module present,
 * plain typed arrays when absent. Executed path is named by governor, and `run()` reports cost.
 *
 * Views are re-queried on each use via `blocs()`: module allocation anywhere might grow
 * its memory and detach previous views. `../page/decode/wasmArena.ts` rebuilds them on same bytes and offsets.
 */

export interface MathLot {
  readonly n: number;
  /** True when views live in module memory: computation executes zero copies. */
  readonly shared: boolean;
  /** True when batch holds EXACTLY `n` elements and has not been released. */
  holds(n: number): boolean;
  /** Runs batch and returns ACTUAL executed path, which may differ from requested path. */
  run(): MathPath;
  release(): void;
}

export interface Tampon {
  /** Module when blocks live in its memory, `null` when in JavaScript heap. */
  readonly wasm: SdkWasm | null;
  blocs(): readonly ArenaBloc[];
  release(): void;
}

/** Batch blocks in module memory if available, otherwise in JavaScript heap. */
export async function tampon(requests: readonly ArenaRequest[]): Promise<Tampon> {
  await loadMathBatch();
  const wasm = mathBatchWasm();
  const arena = wasm ? reserveArena(wasm, requests) : null;
  if (wasm && arena) return { wasm, blocs: arena.blocs, release: arena.freed };
  const blocs = blocsJavaScript(requests);
  return { wasm: null, blocs: () => blocs, release: () => {} };
}

/**
 * Execution helper: governor chooses, clock bounds, governor records. Requested WebAssembly
 * path unequipped falls back to JavaScript, reporting that actual path.
 */
export function joue(
  operation: string,
  n: number,
  wasmRun: (() => void) | null,
  jsRun: () => void,
) {
  const gouverneur = mathGovernor();
  const path: MathPath = gouverneur.choose(operation) === 'wasm' && wasmRun ? 'wasm' : 'js';
  const debut = mathClock();
  if (path === 'wasm' && wasmRun) wasmRun();
  else jsRun();
  const duree = mathClock() - debut;
  gouverneur.observe(operation, path, Number.isFinite(duree) ? duree : null, n);
  return path;
}

export const f64 = (bloc: ArenaBloc) => bloc.view as Float64Array;
export const f64Views = (bloc: ArenaBloc) => (bloc.views ?? []) as readonly Float64Array[];

/** The `length` elements of block `index`, or zero when buffer released. */
export const taille = (blocs: readonly ArenaBloc[], index: number) =>
  blocs[index]?.view.length ?? 0;
