import type { SdkWasm } from '../../../wasm/sdkWasm.ts'
import { mathBatchModule } from './batchState.ts'
import { reserveArena, type ArenaBlock, type ArenaRequest } from '../../../wasm/wasmArena.ts'

/**
 * What all math batches share: buffer and interface shape. The batches themselves are in
 * `batchRuntime.ts`.
 *
 * A batch is a BUFFER, not a function call: caller reserves blocks once, writes inputs
 * directly into returned views, calls `run()` as many times as needed, then releases buffer.
 * The blocks live in the module's memory and its kernel reads them in place: nothing is copied
 * between JavaScript and WebAssembly, and there is no second path.
 *
 * Views are re-queried on each use via `blocks()`: module allocation anywhere might grow
 * its memory and detach previous views. `../../../wasm/wasmArena.ts` rebuilds them on same bytes and offsets.
 */

export interface MathLot {
  readonly n: number
  /** True when batch holds EXACTLY `n` elements and has not been released. */
  holds(n: number): boolean
  /** Runs the module's kernel over the batch. */
  run(): void
  release(): void
}

export interface BatchBuffer {
  readonly wasm: SdkWasm
  blocks(): readonly ArenaBlock[]
  release(): void
}

/** Batch blocks in module memory, or `null` when the module refuses their size (`arena_alloc`):
 *  the caller then takes each element by its single-element function. */
export async function batchBuffer(requests: readonly ArenaRequest[]): Promise<BatchBuffer | null> {
  const wasm = await mathBatchModule()
  const arena = reserveArena(wasm, requests)
  return arena && { wasm, blocks: arena.blocks, release: arena.freed }
}

export const f64 = (block: ArenaBlock) => block.view as Float64Array

/** The `length` elements of block `index`, or zero when buffer released. */
export const size = (blocks: readonly ArenaBlock[], index: number) =>
  blocks[index]?.view.length ?? 0
