import type { DecodedGeometryPage } from './geometryPage.ts';

/**
 * Loader of the SDK WebAssembly module (`packages/page-codec-wasm`) and page decoder that uses it.
 * There is only one module, hence one instantiation and one linear memory for the whole process:
 * `prepareSdkWasm` remembers it, and the core batch kernels (`wasmArena.ts`, `mathBatchRuntime.ts`)
 * work in that same memory.
 *
 * The module imports nothing and exports only its linear memory and its functions: the compressed
 * page is written into that memory, the decoder deposits its buffers there and returns their
 * offsets. Nothing is copied between the two. Buffers returned to the caller, though, are copies:
 * they survive `page_release` and can be transferred to another thread.
 *
 * If `WebAssembly` is missing or instantiation fails, the JavaScript decoder takes over — same
 * buffers, same refusals, only slower. It is loaded then and not before: it pulls the decompression
 * library, named by a bare specifier, which a dedicated worker cannot resolve without a bundler.
 * Leaving it out of the static graph, this loader stays usable where only the WebAssembly module is.
 */

/** Optional attributes, in the order and under the names of the JavaScript decoder. */
const OPTIONNELS: ReadonlyArray<readonly [string, number]> = [
  ['normal', 3],
  ['uv', 2],
  ['tangent', 4],
  ['uv2', 2],
  ['color', 4],
];
/** Refusal causes of the Rust decoder, at the index of their code. */
const CAUSES = [
  '',
  'GEOMETRY_PAGE_HEADER',
  'GEOMETRY_PAGE_VERSION',
  'GEOMETRY_PAGE_BOUNDS',
  'GEOMETRY_PAGE_INDEX',
  'GEOMETRY_PAGE_NONFINITE',
  'GEOMETRY_PAGE_MESHOPT',
];
const MOTS = 12;

/** Module exports, page decoder and batch compute together. */
export type SdkWasm = {
  memory: WebAssembly.Memory;
  page_alloc(len: number): number;
  page_free(offset: number, len: number): void;
  page_decode(offset: number, len: number, maxDecodedBytes: number): number;
  page_release(offset: number): void;
  math_contract(): number;
  math_simd(): number;
  arena_alloc(bytes: number): number;
  arena_free(offset: number, bytes: number): void;
  math_box_transform_batch(out: number, boxes: number, mats: number, n: number): void;
  math_multiply_matrix4_batch(out: number, a: number, b: number, n: number): void;
  math_hierarchy_update_batch(
    world: number,
    positions: number,
    rotations: number,
    scales: number,
    parents: number,
    n: number,
  ): void;
};
type SourceWasm = BufferSource | (() => Promise<BufferSource>);

let attente: Promise<SdkWasm | null> | null = null;

/** Resource shipped next to the module: the browser takes it by URL, not from disk. */
async function ressource(): Promise<BufferSource> {
  const reponse = await fetch(new URL('./pageCodec.wasm', import.meta.url));
  if (!reponse.ok) throw new Error('GEOMETRY_PAGE_WASM');
  return await reponse.arrayBuffer();
}

async function instancie(source: SourceWasm): Promise<SdkWasm | null> {
  try {
    if (typeof WebAssembly === 'undefined') return null;
    const octets = typeof source === 'function' ? await source() : source;
    const { instance } = await WebAssembly.instantiate(octets, {});
    return instance.exports as unknown as SdkWasm;
  } catch {
    return null;
  }
}

/**
 * Instantiates the module once and for all and says whether it is available. The host may supply
 * the bytes — that is what Node does, which cannot follow a file URL with `fetch`.
 */
export function prepareSdkWasm(source: SourceWasm = ressource): Promise<SdkWasm | null> {
  attente ??= instancie(source);
  return attente;
}

/** Result-block buffers, copied out of linear memory before it moves. */
function copie(codec: SdkWasm, bloc: number): DecodedGeometryPage {
  const mots = new Uint32Array(codec.memory.buffer, bloc, MOTS);
  if (mots[0]) throw new Error(CAUSES[mots[0]] ?? 'GEOMETRY_PAGE_BOUNDS');
  const vertexCount = mots[1],
    indexCount = mots[2],
    flags = mots[3],
    decodedBytes = mots[4];
  const indices = new Uint32Array(codec.memory.buffer, mots[5], indexCount).slice();
  const attributes: Record<string, Float32Array> = {
    position: new Float32Array(codec.memory.buffer, mots[6], vertexCount * 3).slice(),
  };
  for (let i = 0; i < OPTIONNELS.length; i++) {
    const offset = mots[7 + i];
    if (offset)
      attributes[OPTIONNELS[i][0]] = new Float32Array(
        codec.memory.buffer,
        offset,
        vertexCount * OPTIONNELS[i][1],
      ).slice();
  }
  return { indices, attributes, vertexCount, flags, decodedBytes };
}

/** Same signature, same buffers and same refusals as `decodeGeometryPage`. */
export async function decodeGeometryPageWasm(
  data: Uint8Array,
  maxDecodedBytes = 16 * 1024 * 1024,
): Promise<DecodedGeometryPage> {
  const codec = await prepareSdkWasm();
  if (!codec) {
    const { decodeGeometryPage } = await import('./geometryPage.ts');
    return decodeGeometryPage(data, maxDecodedBytes);
  }
  if (data.byteLength < 32) throw new Error('GEOMETRY_PAGE_HEADER');
  const inputPtr = codec.page_alloc(data.byteLength);
  if (!inputPtr) throw new Error('GEOMETRY_PAGE_BOUNDS');
  new Uint8Array(codec.memory.buffer, inputPtr, data.byteLength).set(data);
  const bloc = codec.page_decode(inputPtr, data.byteLength, maxDecodedBytes);
  codec.page_free(inputPtr, data.byteLength);
  if (!bloc) throw new Error('GEOMETRY_PAGE_BOUNDS');
  try {
    return copie(codec, bloc);
  } finally {
    codec.page_release(bloc);
  }
}
