import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { MIB } from '../../../../math/src/constants.ts'
import { loadedSdkWasm, type SdkWasm } from '../../wasm/sdkWasm.ts'
import { META, META_WORDS, POOL_WORDS } from '../../wasm/encodeAbi.ts'
import { takeHeld, withArena, type Arena } from '../../wasm/wasmArena.ts'
import { pageAttributeNames, pageViews } from './geometryPageBlock.ts'

/**
 * Decoder of a `WGP3` quantized cluster page (`docs/FORMAT.md`): the SDK module's
 * (`packages/page-codec-wasm/src/unpack.rs`, `wasm/decode.rs`), the one decoder, as the encoder is
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
}

/** The decoded page budget a call may spend unless it names another. */
const DEFAULT_MAX_DECODED_BYTES = 16 * MIB

/** Where a page that names vertices of other clusters finds them (`docs/FORMAT.md`, Pages): the
 *  pool's bytes, and the word of the pool each streaming page it names starts at — its own first,
 *  then each page of its list of dependencies, `NO_UNIT` (`sdk-core/src/page/format.ts`) for one not
 *  resident. */
export type PageReferences = { pool: Uint8Array; units: readonly number[] }

/** The page copied into the module's memory with the block the module answers in, and the pool
 *  its references are found in, if it names any, run through `use`; the memory is freed whatever
 *  `use` does. The module allocates: its memory may have grown and detached the views taken before
 *  a call, so `use` asks `arena.blocks()` again after each. `pool` is the offset of the block that
 *  says where the pool lies, 0 for a page that names none. */
function staged<T>(
  module: SdkWasm,
  data: Uint8Array,
  references: PageReferences | undefined,
  use: (arena: Arena, answer: number, page: number, pool: number) => T,
): T {
  const named = references
    ? [
        { type: 'u32' as const, length: POOL_WORDS },
        { type: 'u32' as const, length: ceilDiv(references.pool.length, 4) },
        { type: 'u32' as const, length: references.units.length },
      ]
    : []
  return withArena(
    module,
    [
      { type: 'u32', length: META_WORDS },
      { type: 'u32', length: ceilDiv(data.length, 4) },
      ...named,
    ],
    'PAGE_DECODER_MEMORY',
    (arena) => {
      const [answer, page, block, held, units] = arena.blocks()
      new Uint8Array(page.view.buffer, page.offset, data.length).set(data)
      if (!references) return use(arena, answer.offset, page.offset, 0)
      const { pool, units: starts } = references
      new Uint8Array(held.view.buffer, held.offset, pool.length).set(pool)
      ;(units.view as Uint32Array).set(starts)
      ;(block.view as Uint32Array).set([held.offset, pool.length, units.offset, starts.length])
      return use(arena, answer.offset, page.offset, block.offset)
    },
  )
}

/** The answer block of the staged reservation, as words. */
const answerOf = (arena: Arena) => arena.blocks()[0].view as Uint32Array

/** Throws the refusal the module wrote in `answer`: its length in word 0, its ASCII from byte 4. */
export function refused(answer: Uint32Array): never {
  const bytes = new Uint8Array(answer.buffer, answer.byteOffset + 4, answer[0])
  throw new Error(new TextDecoder().decode(bytes))
}

/**
 * The format's gate on a page the install pass transcodes into the pool: magic, version, grids,
 * counts that measure exactly this many bytes, and every field read back. Returns the page's counts
 * and the bytes it takes resident in the pool, or throws its `GEOMETRY_PAGE_*` refusal.
 */
export function checkGeometryPage(
  module: SdkWasm,
  data: Uint8Array,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
) {
  return staged(module, data, undefined, (arena, answer, page) => {
    const status = module.page_check(page, data.length, maxDecodedBytes, answer)
    const words = answerOf(arena)
    if (status !== 0) refused(words)
    return {
      vertexCount: words[META.VERTEX_COUNT],
      indexCount: words[META.INDEX_COUNT],
      flags: words[META.FLAGS],
      decodedBytes: words[META.DECODED_BYTES],
      residentBytes: words[META.RESIDENT_BYTES],
      morphTargets: words[META.MORPH_TARGETS],
      skinInfluences: words[META.SKIN_INFLUENCES],
    }
  })
}

/**
 * The resident page of a page on disk — the bytes the install pass writes into the pool, which the
 * shaders read in place (`../cluster/decodeWgsl.ts`) — as the SDK module lays it out
 * (`resident::expand_in`): the pass's CPU twin, which the tests compare the pass to and the CPU
 * readers of the pool's layout take their pages from, a page that names vertices of other
 * clusters finding them where `references` say. Throws the `GEOMETRY_PAGE_*` refusal of a page the
 * format's gate refuses, `GEOMETRY_PAGE_REFS` for a page whose references find nothing.
 */
export function residentGeometryPage(
  data: Uint8Array,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
  references?: PageReferences,
): Uint8Array<ArrayBuffer> {
  const module = loadedSdkWasm()
  return staged(module, data, references, (arena, answer, page, pool) => {
    const status = module.page_resident(page, data.length, maxDecodedBytes, answer, pool)
    if (status !== 0) refused(answerOf(arena))
    return new Uint8Array(takeHeld(module)[0])
  })
}

/**
 * Decode one complete page without referring to any source glTF buffer, through the SDK module
 * (`loadedSdkWasm`: the family that holds this function arrives once the module has). A page that
 * names vertices of other clusters — a compiled page may — is decoded with the resident pages of
 * those clusters, found where `references` say.
 */
export function decodeGeometryPage(
  data: Uint8Array,
  maxDecodedBytes = DEFAULT_MAX_DECODED_BYTES,
  references?: PageReferences,
): DecodedGeometryPage {
  const module = loadedSdkWasm()
  const { decodedBytes, morphTargets, skinInfluences, ...counts } = checkGeometryPage(
    module,
    data,
    maxDecodedBytes,
  )
  const block = new ArrayBuffer(decodedBytes)
  withArena(module, [{ type: 'u32', length: decodedBytes / 4 }], 'PAGE_DECODER_MEMORY', (out) => {
    staged(module, data, references, (arena, answer, page, pool) => {
      const status = module.page_unpack(
        page,
        data.length,
        maxDecodedBytes,
        answer,
        out.blocks()[0].offset,
        pool,
      )
      if (status !== 0) refused(answerOf(arena))
    })
    const [source] = out.blocks()
    new Uint8Array(block).set(new Uint8Array(source.view.buffer, source.offset, decodedBytes))
  })
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
  }
}
