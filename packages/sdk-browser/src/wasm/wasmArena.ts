import { alignUp } from '../../../math/src/scalar/integers.ts'
import type { SdkWasm } from './sdkWasm.ts'

/**
 * Shared buffer: blocks reserved in the linear memory of the SDK WebAssembly module, on which
 * JavaScript lays its typed views. Both sides read and write the same bytes; nothing is copied
 * on the compute path.
 *
 * GROWTH, HELD BY A GENERATION. `WebAssembly.Memory.grow` replaces the `ArrayBuffer` and detaches
 * every view already built: a stale view reads zero without signalling anything. Any module
 * allocation can trigger it — the run-time cut's cones or the animation sampler as much as a second
 * reservation — so forbidding it elsewhere was not enough. Here `blocks()` compares the module's
 * current buffer to the one that carried the views and REBUILDS them all when it has changed,
 * counting one more generation. The bytes themselves survive: `grow` copies the memory, so a
 * block keeps its offset and its contents. We never copy anything ourselves.
 *
 * A caller therefore does not keep a view from one frame to the next: it asks again through
 * `blocks()`, which costs only a buffer comparison as long as memory has not moved. Offsets are
 * stable for the whole life of the buffer — they are what the module functions receive.
 *
 * A block carries its own type: `Float64Array` for matrices, boxes, spheres and errors,
 * `Float32Array` for what already arrives in single precision, `Uint32Array` for flags, ids and
 * counters. A variable-size output is declared as two blocks — a one-word counter, a list at its
 * maximum size — and is reread with `list()`.
 */

/** Version of the buffer and lot contract. A module that yields anything else is refused. */
export const WASM_ARENA_CONTRACT = 1

/** Alignment of each block, in bytes: that of an `f64`, which also covers 32 bits. */
const ALIGNMENT = 8

type ArenaType = 'f64' | 'f32' | 'u32'
type ArenaView = Float64Array | Float32Array | Uint32Array

const SIZES: Record<ArenaType, number> = { f64: 8, f32: 4, u32: 4 }
const CONSTRUCTORS = {
  f64: Float64Array,
  f32: Float32Array,
  u32: Uint32Array,
} as const

export interface ArenaRequest {
  readonly type: ArenaType
  /** Number of elements in the block. For a variable-size output, its maximum. */
  readonly length: number
  /** Stride of the subviews, in elements; absent when the block does not need them. */
  readonly stride?: number
}

export interface ArenaBlock {
  readonly type: ArenaType
  /** Offset in BYTES in linear memory: what the module functions expect. */
  readonly offset: number
  readonly view: ArenaView
  /** Subviews of `stride` elements, or `null` when the request did not ask for them. */
  readonly views: readonly ArenaView[] | null
}

export interface Arena {
  /**
   * Blocks of the buffer, their views rebuilt if the module memory has grown since the last
   * call. Empty once the buffer is released: no view still points at memory of ours.
   */
  blocks(): readonly ArenaBlock[]
  /** Rebuilds undergone since reservation. Zero says memory has never moved. */
  generation(): number
  readonly bytes: number
  /** First `n` elements of a block: the useful part of a variable-size output. */
  list(index: number, n: number): ArenaView
  freed(): void
}

/** A block and its subviews, whichever memory carries it. */
function block(request: ArenaRequest, offset: number, view: ArenaView): ArenaBlock {
  const stride = request.stride ?? 0
  let views: ArenaView[] | null = null
  if (stride > 0) {
    const count = Math.floor(request.length / stride)
    views = new Array(count)
    for (let i = 0; i < count; i++) views[i] = view.subarray(i * stride, i * stride + stride)
  }
  return { type: request.type, offset, view, views }
}

/**
 * The same blocks outside the module memory: what the JavaScript path works on when
 * WebAssembly is missing. Their `offset` is zero — it names no linear memory.
 */
export function javaScriptBlocks(requests: readonly ArenaRequest[]): ArenaBlock[] {
  return requests.map((request) =>
    block(request, 0, new CONSTRUCTORS[request.type](request.length)),
  )
}

/**
 * Reserves the requested blocks in one allocation and returns their views. `null` when the
 * module refuses the size: the caller then stays on the JavaScript path, with its own arrays.
 */
export function reserveArena(wasm: SdkWasm, requests: readonly ArenaRequest[]): Arena | null {
  const plan: { request: ArenaRequest; start: number }[] = []
  let bytes = 0
  for (const request of requests) {
    plan.push({ request, start: bytes })
    bytes += alignUp(request.length * SIZES[request.type], ALIGNMENT)
  }
  const base = wasm.arena_alloc(bytes)
  if (!base) return null
  const build = () =>
    plan.map(({ request, start }) =>
      block(
        request,
        base + start,
        new CONSTRUCTORS[request.type](wasm.memory.buffer, base + start, request.length),
      ),
    )
  let blocks = build()
  let carrier = wasm.memory.buffer
  let generation = 0
  let released = false
  /** Up-to-date blocks: one buffer comparison, and a rebuild only if it has changed. */
  const current = () => {
    if (!released && wasm.memory.buffer !== carrier) {
      carrier = wasm.memory.buffer
      generation++
      blocks = build()
    }
    return blocks
  }
  return {
    blocks: current,
    generation: () => generation,
    bytes,
    list: (index, n) => current()[index].view.subarray(0, n),
    freed: () => {
      if (released) return
      released = true
      blocks = []
      wasm.arena_free(base, bytes)
    },
  }
}
