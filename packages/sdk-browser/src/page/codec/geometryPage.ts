import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { MIB } from '../../../../math/src/constants.ts'
import { loadedSdkWasm, type SdkWasm } from '../../wasm/sdkWasm.ts'
import { META_WORDS } from '../../wasm/encodeAbi.ts'
import { UNPACKED } from '../../wasm/decodeAbi.ts'
import { reserveArena, type Arena } from '../../wasm/wasmArena.ts'
import { pageAttributeNames, pageViews } from './geometryPageBlock.ts'

/**
 * Decoder of a `WGP3` quantized cluster page (`docs/FORMAT.md`): the SDK module's
 * (`packages/page-codec-wasm/src/unpack.rs`, `wasm_decode.rs`), the one decoder, as the encoder is
 * the one encoder. The module lays the page out as 32-bit words; every float is the 32-bit float
 * the format prescribes, which the WGSL routines decode alike.
 */
/** A decoded page: `indices` and every attribute are views on one buffer of `decodedBytes`
 *  (`geometryPageBlock.ts`). */
export type DecodedGeometryPage = {
  /** The triangle indices. */
  indices: Uint32Array<ArrayBuffer>
  /** The vertex lists by name. */
  attributes: Record<string, Float32Array<ArrayBuffer>>
  /** Vertices. */
  vertexCount: number
  /** Morph targets: `attributes.morph` holds six floats of each per vertex; absent, none. */
  morphTargets?: number
  /** Number of source skin influences per vertex. */
  skinInfluences?: number
  /** Which attributes it carries. */
  flags: number
  /** Its size once unpacked. */
  decodedBytes: number
  /** The header's largest position displacement, in object units: a decoded position may lie
   *  that far from its source, and so from the page's declared box. */
  quantizationError: number
}

/** The decoded page budget a call may spend unless it names another. */
const DEFAULT_MAX_DECODED_BYTES = 16 * MIB

/** The module's memory is shared by all callers; a refusal to reserve it is an error. */
const memoryRefused = () => new Error('PAGE_DECODER_MEMORY')

/** The page copied into the module's memory with the block the module answers in, run through
 *  `use`; the memory is freed whatever `use` does. The module allocates: its memory may have grown
 *  and detached the views taken before a call, so `use` asks `arena.blocks()` again after each. */
function staged<T>(
  module: SdkWasm,
  data: Uint8Array,
  use: (arena: Arena, answer: number, page: number) => T,
): T {
  const arena = reserveArena(module, [
    { type: 'u32', length: META_WORDS },
    { type: 'u32', length: ceilDiv(data.length, 4) },
  ])
  if (!arena) throw memoryRefused()
  try {
    const [answer, page] = arena.blocks()
    new Uint8Array(page.view.buffer, page.offset, data.length).set(data)
    return use(arena, answer.offset, page.offset)
  } finally {
    arena.freed()
  }
}

/** The answer block of the staged reservation, as words. */
const answerOf = (arena: Arena) => arena.blocks()[0].view as Uint32Array

/** Throws the refusal the module wrote in `answer`: its length in word 0, its ASCII from byte 4. */
function refused(answer: Uint32Array): never {
  const bytes = new Uint8Array(answer.buffer, answer.byteOffset + 4, answer[0])
  throw new Error(new TextDecoder().decode(bytes))
}

/**
 * The format's gate on a page the pool uploads as it is and the shaders decode in place: magic,
 * version, grids, and counts that measure exactly this many bytes. Returns the page's counts, or
 * throws its `GEOMETRY_PAGE_*` refusal.
 */
export function checkGeometryPage(
  module: SdkWasm,
  data: Uint8Array,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
) {
  return staged(module, data, (arena, answer, page) => {
    const status = module.page_check(page, data.length, maxDecodedBytes, answer)
    const words = answerOf(arena)
    if (status !== 0) refused(words)
    return {
      vertexCount: words[UNPACKED.VERTEX_COUNT],
      indexCount: words[UNPACKED.INDEX_COUNT],
      flags: words[UNPACKED.FLAGS],
      decodedBytes: words[UNPACKED.DECODED_BYTES],
      quantizationError: new Float32Array(
        words.buffer,
        words.byteOffset + UNPACKED.QUANTIZATION_ERROR * 4,
        1,
      )[0],
      morphTargets: words[UNPACKED.MORPH_TARGETS],
      skinInfluences: words[UNPACKED.SKIN_INFLUENCES],
    }
  })
}

/**
 * Decode one complete page without referring to any source glTF buffer, through the SDK module
 * (`loadedSdkWasm`: the family that holds this function arrives once the module has).
 */
export function decodeGeometryPage(
  data: Uint8Array,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
): DecodedGeometryPage {
  const module = loadedSdkWasm()
  const { decodedBytes, morphTargets, skinInfluences, ...counts } = checkGeometryPage(
    module,
    data,
    maxDecodedBytes,
  )
  const block = new ArrayBuffer(decodedBytes)
  const out = reserveArena(module, [{ type: 'u32', length: decodedBytes / 4 }])
  if (!out) throw memoryRefused()
  try {
    staged(module, data, (arena, answer, page) => {
      const status = module.page_unpack(
        page,
        data.length,
        maxDecodedBytes,
        answer,
        out.blocks()[0].offset,
      )
      if (status !== 0) refused(answerOf(arena))
    })
    const [source] = out.blocks()
    new Uint8Array(block).set(new Uint8Array(source.view.buffer, source.offset, decodedBytes))
  } finally {
    out.freed()
  }
  const { indices, attributes } = pageViews(
    block,
    pageAttributeNames(counts.flags),
    counts.vertexCount,
    morphTargets,
    skinInfluences,
  )
  return {
    indices,
    attributes,
    vertexCount: counts.vertexCount,
    morphTargets,
    skinInfluences,
    flags: counts.flags,
    decodedBytes,
    quantizationError: counts.quantizationError,
  }
}
