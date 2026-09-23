//! Bit fields and dequantization of a `WGP3` page, written once for every reader: the
//! WebAssembly decoder, the native compiler (which measures its own error with them) and the
//! tests. The WGSL and JavaScript decoders repeat these formulas operation for operation —
//! one multiply and one add per component, both correctly rounded — so a position decoded on
//! the GPU is the same 32-bit float as one decoded here.

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

/// The `bits`-bit field at bit `at` of `words`. A field never spans more than two words, and a
/// stream is sized so the second word exists whenever the field needs it.
pub fn field(words: &[u32], at: usize, bits: u32) -> u32 {
    if bits == 0 {
        return 0;
    }
    let shift = (at % 32) as u32;
    let index = at / 32;
    let mut value = u64::from(words[index]) >> shift;
    if shift + bits > 32 {
        value |= u64::from(words[index + 1]) << (32 - shift);
    }
    (value & ((1u64 << bits) - 1)) as u32
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
mod tests {
    use super::*;

    #[test]
    fn a_field_crosses_a_word_boundary_and_a_zero_width_field_reads_zero() {
        let words = [0xF000_0000u32, 0x0000_00AB];
        assert_eq!(field(&words, 28, 12), 0xABF);
        assert_eq!(field(&words, 28, 0), 0);
        assert_eq!(field(&words, 32, 8), 0xAB);
        assert_eq!(bits_for(0), 0);
        assert_eq!(bits_for(255), 8);
        assert_eq!(bits_for(256), 9);
        assert_eq!(stream_words(3, 24), 3);
    }

    #[test]
    fn the_step_is_exact_and_the_record_survives_its_word() {
        assert_eq!(pow2(-16), 1.0 / 65536.0);
        assert_eq!(pow2(3), 8.0);
        let record = Quant {
            min: [1.5, -2.0, 0.0],
            exponent: -20,
            bits: [17, 0, 24],
        };
        assert_eq!(Quant::unpack(record.packed(), record.min), Some(record));
        assert_eq!(Quant::<3>::unpack(25, record.min), None);
        assert_eq!(Quant::<3>::unpack(1 << 18, record.min), None);
        assert_eq!(
            Quant::<3>::unpack(record.packed(), [f32::NAN, 0.0, 0.0]),
            None
        );
        assert_eq!(dequant(1.5, 3, 0.25), 2.25);
    }

    #[test]
    fn octahedral_bytes_decode_to_unit_vectors_on_both_hemispheres() {
        for q in [0u32, 255, 255 << 8, 0xFFFF, 128 | (128 << 8), 0x40C0] {
            let [x, y, z] = oct_decode(q);
            assert!((x * x + y * y + z * z - 1.0).abs() < 1e-6, "{q}");
        }
        assert!(oct_decode(0)[2] < 0.0);
        assert!(oct_decode(128 | (128 << 8))[2] > 0.99);
    }
}
