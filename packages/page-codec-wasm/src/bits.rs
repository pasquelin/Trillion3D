//! Bit fields and dequantization of a `WGP3` page, written once for every reader: the
//! WebAssembly decoder, the native compiler (which measures its own error with them) and the
//! tests. The WGSL and JavaScript decoders repeat these formulas operation for operation —
//! one multiply and one add per component, both correctly rounded — so a position decoded on
//! the GPU is the same 32-bit float as one decoded here.

pub mod grid;

/// Widest field of the format: a 24-bit field read at any bit offset spans two words at most.
pub const MAX_BITS: u32 = 24;
/// Largest magnitude of a grid exponent: the step stays a normal `f32`.
pub const MAX_EXPONENT: i32 = 64;
/// `2 / 255` as the nearest `f32`: an octahedral byte to `[-1, 1]`, the value `packages/sdk-browser/src/cluster/format.ts`
/// rounds the same way.
pub const OCT_SCALE: f32 = 2.0 / 255.0;

/// Bits needed to hold every value of `0..=range`; zero for a constant field.
pub fn bits_for(range: u32) -> u32 {
    u32::BITS - range.leading_zeros()
}

/// Words a stream of `count` fields of `bits` bits occupies; saturating, so a forged count
/// on a 32-bit `usize` cannot wrap into a layout that matches the bytes.
pub fn stream_words(count: usize, bits: u32) -> usize {
    count.saturating_mul(bits as usize).div_ceil(32)
}

/// The fields of one stream in order, each word loaded once (STR-01, #238): the stream's current
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

/// A grid value back to its float: `min + q * step`, the product exact, the sum rounded once.
pub fn dequant(min: f32, q: u32, step: f32) -> f32 {
    min + q as f32 * step
}

/// Two octahedral bytes (`x` low, `y` high) back to a unit vector.
pub fn oct_decode(q: u32) -> [f32; 3] {
    let x = (q & 255) as f32 * OCT_SCALE - 1.0;
    let y = ((q >> 8) & 255) as f32 * OCT_SCALE - 1.0;
    let z = 1.0 - x.abs() - y.abs();
    let (x, y) = if z < 0.0 {
        (
            (1.0 - y.abs()) * if x >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - x.abs()) * if y >= 0.0 { 1.0 } else { -1.0 },
        )
    } else {
        (x, y)
    };
    let length = (x * x + y * y + z * z).sqrt();
    [x / length, y / length, z / length]
}

/// Quantization record of a vector attribute: one exponent, per-component minima and widths.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quant<const N: usize> {
    pub min: [f32; N],
    pub exponent: i32,
    pub bits: [u32; N],
}

impl<const N: usize> Quant<N> {
    /// The record of a constant attribute: every vertex reads zero, on the grid of `exponent`.
    pub fn flat(exponent: i32) -> Self {
        Self {
            min: [0.0; N],
            exponent,
            bits: [0; N],
        }
    }

    /// The widths and the exponent in one word: six bits per width from bit 0 — four of them
    /// fit —, the exponent as a signed byte in the top byte.
    pub fn packed(&self) -> u32 {
        let mut word = (self.exponent as u8 as u32) << 24;
        for (c, &bits) in self.bits.iter().enumerate() {
            word |= bits << (6 * c);
        }
        word
    }

    /// The record read back from its word and its minima; `None` outside the format's bounds.
    pub fn unpack(word: u32, min: [f32; N]) -> Option<Self> {
        let exponent = i32::from((word >> 24) as u8 as i8);
        let mut bits = [0u32; N];
        for (c, slot) in bits.iter_mut().enumerate() {
            *slot = (word >> (6 * c)) & 63;
        }
        let record = Self {
            min,
            exponent,
            bits,
        };
        // Repacking the record must give the word back: no stray bit above the widths.
        let sane = exponent.abs() <= MAX_EXPONENT
            && bits.iter().all(|&b| b <= MAX_BITS)
            && min.iter().all(|m| m.is_finite())
            && record.packed() == word;
        sane.then_some(record)
    }

    pub fn step(&self) -> f32 {
        pow2(self.exponent)
    }
}

#[cfg(test)]
#[path = "bits_tests.rs"]
pub(crate) mod tests;
