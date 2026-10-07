import { checked } from '../cluster/checked.ts'

/**
 * Loader of the SDK WebAssembly module (`packages/page-codec-wasm`). There is only one module,
 * hence one instantiation and one linear memory for the whole process: `prepareSdkWasm` remembers
 * it, and the core batch kernels (`wasmArena.ts`, `../page/decode/batch/batchRuntime.ts`) work in that same
 * memory. The module imports nothing and exports only its linear memory and its functions.
 */

/** Module exports: the batch compute kernels and their arena. */
export type SdkWasm = {
  memory: WebAssembly.Memory
  math_contract(): number
  math_simd(): number
  arena_alloc(bytes: number): number
  arena_free(offset: number, bytes: number): void
  math_box_transform_batch(out: number, boxes: number, mats: number, n: number): void
  math_multiply_matrix4_batch(out: number, a: number, b: number, n: number): void
  /** The animation sampler (`../animation/batchAnimation.ts`). */
  anim_sample_tracks(
    tracks: number,
    n: number,
    data: number,
    dataLength: number,
    keys: number,
    arcs: number,
    out: number,
    outLength: number,
    t: number,
  ): void
  /** The normal cone of the run-time cut's clusters (`../world/page/cutCones.ts`): 0 written,
   *  1 refused. */
  cone_clusters(
    positions: number,
    positionValues: number,
    indices: number,
    indexValues: number,
    ranges: number,
    clusters: number,
    out: number,
  ): number
  /** The compiler's position and texture grids for the run-time cut (`../world/page/cutGrid.ts`). */
  position_grid_exponent(
    extent: number,
    blended: number,
    finestError: number,
    scale: number,
  ): number
  texture_grid_exponent(span: number, blended: number): number
}
type WasmSource = BufferSource | (() => Promise<BufferSource>)

let pending: Promise<SdkWasm | null> | null = null

/** Resource shipped next to the module: the browser takes it by URL, not from disk. */
async function resource(): Promise<BufferSource> {
  const response = await checked(new URL('./kernels.wasm', import.meta.url).href)
  return await response.arrayBuffer()
}

async function instantiate(source: WasmSource): Promise<SdkWasm | null> {
  try {
    if (typeof WebAssembly === 'undefined') return null
    const bytes = typeof source === 'function' ? await source() : source
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return instance.exports as unknown as SdkWasm
  } catch {
    return null
  }
}

/**
 * Instantiates the module once and for all and says whether it is available. The host may supply
 * the bytes — that is what Node does, which cannot follow a file URL with `fetch`.
 */
export function prepareSdkWasm(source: WasmSource = resource): Promise<SdkWasm | null> {
  pending ??= instantiate(source)
  return pending
}
