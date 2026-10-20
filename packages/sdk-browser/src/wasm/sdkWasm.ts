import { checked } from '../geometry/cluster/checked.ts'

/**
 * Loader of the SDK WebAssembly module (`packages/page-codec-wasm`). There is only one module,
 * hence one instantiation and one linear memory for the whole process: `requireSdkWasm` remembers
 * it, and the core batch kernels (`wasmArena.ts`, `../geometry/decode/batchRuntime.ts`) work in that same
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
  /** The answer the last build holds, sized only once built (`page-codec-wasm/src/wasm/held.rs`): its
   *  byte offset and length in linear memory, and its release; read through `takeHeld`
   *  (`wasmArena.ts`). */
  held_at(): number
  held_length(): number
  held_free(): void
  /** The page encoder of the run-time cut (`../geometry/codec/encodeGeometryPage.ts`): 0 written, the
   *  page held; 1 refused, its code in the answer block. */
  encode_page(request: number, answer: number): number
  /** The proxy of a run-time cut (`../geometry/runtime/runtimeProxy.ts`): 0 built, the columns held. */
  proxy_build(
    indices: number,
    indexCount: number,
    positions: number,
    vertexCount: number,
    answer: number,
  ): number
  /** The page decoder (`../geometry/codec/geometryPage.ts`): `page_check` gates a page's header and
   *  answers its counts, `page_unpack` writes its indices and attributes into a block of the
   *  decoded bytes; each 0 when it succeeds, 1 with the refusal's code in the answer block. */
  page_check(data: number, length: number, maxDecodedBytes: number, answer: number): number
  page_unpack(
    data: number,
    length: number,
    maxDecodedBytes: number,
    answer: number,
    out: number,
  ): number
  /** The clusters of the run-time cut (`../geometry/codec/clusterTriangles.ts`): 0 built, the answer
   *  held; 1 refused. */
  cluster_build(
    indices: number,
    indexCount: number,
    positions: number,
    vertexCount: number,
    rule: number,
    caps: number,
    meta: number,
  ): number
  /** The culling hierarchy of the run-time cut's pages (`../geometry/codec/cullingHierarchy.ts`): 0
   *  built, the answer held; 1 refused. */
  culling_build(records: number, count: number, meta: number): number
  /** The position and texture grids of a primitive (`../geometry/runtime/cutGrid.ts`), two signed words
   *  at `out`: `uvs` 0 for none, no `ranges` a span over every vertex, NaN where nothing is known,
   *  `blended` 0 or 1. */
  grid_exponents(
    positions: number,
    vertexCount: number,
    uvs: number,
    indices: number,
    ranges: number,
    rangeCount: number,
    blended: number,
    finestError: number,
    scale: number,
    out: number,
  ): void
}
type WasmSource = BufferSource | (() => Promise<BufferSource>)

let pending: Promise<SdkWasm | null> | null = null
let ready: SdkWasm | null = null

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
    return (ready = instance.exports as unknown as SdkWasm)
  } catch {
    return null
  }
}

/**
 * The module, instantiated once and for all, or an error naming that the page encoder has nowhere
 * to run: the run-time cut writes its pages with it and has no second encoder. The host may supply
 * the bytes — that is what Node does, which cannot follow a file URL with `fetch`.
 */
export async function requireSdkWasm(source: WasmSource = resource): Promise<SdkWasm> {
  const module = await (pending ??= instantiate(source))
  if (!module || typeof module.encode_page !== 'function') throw new Error('SDK_WASM_UNAVAILABLE')
  return module
}

/** The module once `requireSdkWasm` has resolved, for the code that runs after its family has
 *  loaded (`../session/host/families.ts`) and cannot wait: an error naming that it was not awaited. */
export function loadedSdkWasm(): SdkWasm {
  if (!ready) throw new Error('SDK_WASM_UNAVAILABLE')
  return ready
}
