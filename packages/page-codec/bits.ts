/**
 * One read of a `WGP3` page's bit-packed field, at random rather than along a stream. The rule is
 * the shared codec's: `bits.rs` writes it down as `BitReader::at(words, at).read(bits)` — "a single
 * field read at random, as a block record is" (`packages/page-codec-wasm/src/bits.rs`) — and a
 * field at most `MAX_BITS` wide therefore spans two words at most.
 *
 * It belongs here rather than in a reader because three modules read fields and none of them is
 * the one that parses the header: the header's block table and link bounds, the deformation
 * streams, and the page decoder. The other rule those callers share, `bitsFor`, is already exported
 * by `pageGrids.ts`.
 */

/** The `bits`-bit field at bit `at` of `words`; a field spans two words at most. */
export function field(words: Uint32Array, at: number, bits: number) {
  if (!bits) return 0;
  const shift = at % 32,
    index = at >>> 5;
  let value = words[index] >>> shift;
  if (shift + bits > 32) value |= words[index + 1] << (32 - shift);
  return value & ((1 << bits) - 1);
}
