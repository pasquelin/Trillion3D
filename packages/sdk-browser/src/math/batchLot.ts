import type { MathPath } from '../../../sdk-core/src/index.ts'
import type { SdkWasm } from './wasm/sdkWasm.ts'
import { mathClock, mathBatchWasm, mathGovernor, loadMathBatch } from './batchState.ts'
import {
  javaScriptBlocks,
  reserveArena,
  type ArenaBlock,
  type ArenaRequest,
} from './wasm/wasmArena.ts'

/**
 * What all math batches share: buffer, timed execution, and interface shape.
 * The batches themselves are in `batchRuntime.ts`.
 *
 * A batch is a BUFFER, not a function call: caller reserves blocks once, writes inputs
 * directly into returned views, calls `run()` as many times as needed, then releases buffer.
 * Nothing is copied between JavaScript and WebAssembly — same memory when module present,
 * plain typed arrays when absent. Executed path is named by governor, and `run()` reports cost.
 *
 * Views are re-queried on each use via `blocks()`: module allocation anywhere might grow
 * its memory and detach previous views. `./wasm/wasmArena.ts` rebuilds them on same bytes and offsets.
 */

export interface MathLot {
  readonly n: number
  /** True when views live in module memory: computation executes zero copies. */
  readonly shared: boolean
  /** True when batch holds EXACTLY `n` elements and has not been released. */
  holds(n: number): boolean
  /** Runs batch and returns ACTUAL executed path, which may differ from requested path. */
  run(): MathPath
  release(): void
}

export interface BatchBuffer {
  /** Module when blocks live in its memory, `null` when in JavaScript heap. */
  readonly wasm: SdkWasm | null
  blocks(): readonly ArenaBlock[]
  release(): void
}

/** Batch blocks in module memory if available, otherwise in JavaScript heap. */
export async function batchBuffer(requests: readonly ArenaRequest[]): Promise<BatchBuffer> {
  await loadMathBatch()
  const wasm = mathBatchWasm()
  const arena = wasm ? reserveArena(wasm, requests) : null
  if (wasm && arena) return { wasm, blocks: arena.blocks, release: arena.freed }
  const blocks = javaScriptBlocks(requests)
  return { wasm: null, blocks: () => blocks, release: () => {} }
}

/**
 * Execution helper: governor chooses, clock bounds, governor records. Requested WebAssembly
 * path unequipped falls back to JavaScript, reporting that actual path.
 */
export function runTimed(
  operation: string,
  n: number,
  wasmRun: (() => void) | null,
  jsRun: () => void,
) {
  const governor = mathGovernor()
  const path: MathPath = governor.choose(operation) === 'wasm' && wasmRun ? 'wasm' : 'js'
  const start = mathClock()
  if (path === 'wasm' && wasmRun) wasmRun()
  else jsRun()
  const duration = mathClock() - start
  governor.observe(operation, path, Number.isFinite(duration) ? duration : null, n)
  return path
}

export const f64 = (block: ArenaBlock) => block.view as Float64Array
export const f64Views = (block: ArenaBlock) => (block.views ?? []) as readonly Float64Array[]

/** The `length` elements of block `index`, or zero when buffer released. */
export const size = (blocks: readonly ArenaBlock[], index: number) =>
  blocks[index]?.view.length ?? 0
