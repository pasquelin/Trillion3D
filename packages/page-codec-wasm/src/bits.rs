//! Bit fields, dequantization and octahedral normals of a `WGP3` page, each beside its encoder
//! (`quant`, `oct`), written once for every reader: the WebAssembly decoder, the native compiler
//! (which encodes and measures its own error with them) and the tests. The WGSL and JavaScript decoders repeat these formulas operation for operation —
//! one multiply and one add per component, both correctly rounded — so a position decoded on
//! the GPU is the same 32-bit float as one decoded here.

pub mod grid;
mod log2;
mod oct;
mod quant;
pub(crate) use oct::oct_decode_stream;
pub use quant::{dequant, quantization_error, quantize, Quant, QuantRefusal};

/// Widest field of the format: a 24-bit field read at any bit offset spans two words at most.
pub const MAX_BITS: u32 = 24;
/// Largest magnitude of a grid exponent: the step stays a normal `f32`.
pub const MAX_EXPONENT: i32 = 64;

/// Bits needed to hold every value of `0..=range`; zero for a constant field.
pub fn bits_for(range: u32) -> u32 {
    u32::BITS - range.leading_zeros()
}

/// Words a stream of `count` fields of `bits` bits occupies; saturating, so a forged count
/// on a 32-bit `usize` cannot wrap into a layout that matches the bytes.
pub fn stream_words(count: usize, bits: u32) -> usize {
    count.saturating_mul(bits as usize).div_ceil(32)
}

/// The fields of one stream in order, each word loaded once (STR-01): the stream's current
/// word and bit cursor stay in a 64-bit accumulator, refilled one word at a time — never more,
/// since a field is at most `MAX_BITS` wide. A stream is sized so the next word exists whenever
/// a field needs it; a zero-width field reads zero and loads no word.
pub struct BitReader<'a> {
    words: &'a [u32],
    next: usize,
    acc: u64,
    held: u32,
}

impl<'a> BitReader<'a> {
    /// A reader whose first field starts at bit `at` of `words`: a single field read at random,
    /// as a block record is, is `BitReader::at(words, at).read(bits)`.
    #[inline(always)]
    pub fn at(words: &'a [u32], at: usize) -> Self {
        let mut reader = Self {
            words,
            next: at / 32,
            acc: 0,
            held: 0,
        };
        reader.read((at % 32) as u32);
        reader
    }

    /// The next `bits`-bit field, `bits` at most 31 (a field is at most `MAX_BITS`).
    #[inline(always)]
    pub fn read(&mut self, bits: u32) -> u32 {
        if self.held < bits {
            self.acc |= u64::from(self.words[self.next]) << self.held;
            self.next += 1;
            self.held += 32;
        }
        let value = (self.acc & ((1u64 << bits) - 1)) as u32;
        self.acc >>= bits;
        self.held -= bits;
        value
    }
}

/// The little-endian words of `bytes`, a trailing partial word dropped.
pub fn le_words(bytes: &[u8]) -> impl Iterator<Item = u32> + '_ {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(*b))
}

/// `2^exponent` as an exact `f32`, built from its bits: no rounding, whatever the platform.
pub fn pow2(exponent: i32) -> f32 {
    f32::from_bits(((exponent + 127) as u32) << 23)
}

#[cfg(test)]
#[path = "bits_tests.rs"]
pub(crate) mod tests;
