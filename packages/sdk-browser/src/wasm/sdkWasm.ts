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
  /** The page encoder of the run-time cut (`../page/codec/encodeGeometryPage.ts`): 0 written, the
   *  page waiting for `encode_page_take`; 1 refused, its code in the answer block. */
  encode_page(request: number, answer: number): number
  encode_page_take(out: number): void
  /** The proxy of a run-time cut (`../world/page/runtimeProxy.ts`): 0 built, the columns waiting
   *  for `proxy_build_take`. */
  proxy_build(
    indices: number,
    indexCount: number,
    positions: number,
    vertexCount: number,
    answer: number,
  ): number
  proxy_build_take(out: number): void
  /** The page decoder (`../page/codec/geometryPage.ts`): `page_check` gates a page's header and
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
  /** The grids of a primitive (`../world/page/cutGrid.ts`): NaN where nothing is known, `blended`
   *  0 or 1. */
  /** The clusters of the run-time cut (`../page/codec/clusterTriangles.ts`): 0 built, the answer
   *  waiting for `cluster_build_take`; 1 refused. */
  cluster_build(
    indices: number,
    indexCount: number,
    positions: number,
    vertexCount: number,
    rule: number,
    caps: number,
    meta: number,
  ): number
  cluster_build_take(indices: number, ends: number): void
  /** The culling hierarchy of the run-time cut's pages (`../page/codec/cullingHierarchy.ts`): 0
   *  built, the answer waiting for `culling_build_take`; 1 refused. */
  culling_build(records: number, count: number, meta: number): number
  culling_build_take(nodes: number, order: number): void
  grid_tile_log2(scale: number): number
  grid_position_exponent(
    extent: number,
    finestError: number,
    blended: number,
    tileLog2: number,
  ): number
  grid_uv_exponent(span: number, blended: number): number
  grid_drawn_uv_exponent(span: number, blended: number): number
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
 * Instantiates the module once and for all and says whether it is available. The host may supply
 * the bytes — that is what Node does, which cannot follow a file URL with `fetch`.
 */
export function prepareSdkWasm(source: WasmSource = resource): Promise<SdkWasm | null> {
  pending ??= instantiate(source)
  return pending
}

/** The module, or an error naming that the page encoder has nowhere to run: the run-time cut
 *  writes its pages with it and has no second encoder. */
export async function requireSdkWasm(): Promise<SdkWasm> {
  const module = await prepareSdkWasm()
  if (!module || typeof module.encode_page !== 'function') throw new Error('SDK_WASM_UNAVAILABLE')
  return module
}

/** The module once `requireSdkWasm` has resolved, for the code that runs after its family has
 *  loaded (`../host/families.ts`) and cannot wait: an error naming that it was not awaited. */
export function loadedSdkWasm(): SdkWasm {
  if (!ready) throw new Error('SDK_WASM_UNAVAILABLE')
  return ready
}
