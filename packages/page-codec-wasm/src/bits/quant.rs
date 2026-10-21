//! The records a page carries for the grids of its attributes, and the codes they hold: the grid of
//! its positions (`PositionGrid`, `quantize_positions`), the range of each texture set's float
//! codes (`UvRange`, `uv_code`, `uv_value`) and of its colour's bytes (`ColorRange`,
//! `color_byte`, `color_value`). The encoder writes the codes and the records; every reader
//! decodes with the same functions, which the WGSL decoders repeat operation for operation.

use super::{bits_for, pow2};
use crate::{
    CENTIMETRES_PER_METRE, COLOR_BITS, COLOR_LEVELS, MAX_POSITION_BITS, MAX_POSITION_PRECISION,
    MIN_POSITION_PRECISION, UV_CODE_BITS, UV_EXPONENT_BITS, UV_MANTISSA_BITS,
};

/// The grid a page's positions sit on: cells of `2^-precision` centimetre, a vertex's cell its
/// position in centimetres times `2^precision`, rounded. The page keeps the cell of its least
/// vertex on each axis (`start`) and, per vertex, its cell above it in `bits` bits an axis.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PositionGrid {
    pub start: [i32; 3],
    pub bits: [u32; 3],
    pub precision: i32,
}

impl PositionGrid {
    /// The record of a page whose positions are all one cell, `start` zero.
    pub fn flat(precision: i32) -> Self {
        Self {
            precision,
            ..Self::default()
        }
    }

    /// The widths and the precision in one word: six bits per width from bit 0, the precision as a
    /// signed byte in the top byte.
    pub fn packed(&self) -> u32 {
        let [x, y, z] = self.bits;
        x | y << 6 | z << 12 | u32::from(self.precision as i8 as u8) << 24
    }

    /// The record read back from its word and its start; `None` outside the format's bounds: a
    /// precision or a width past the format's, a stray bit above the widths, or a cell, the start
    /// plus the greatest offset, past an `i32`.
    pub fn unpack(word: u32, start: [i32; 3]) -> Option<Self> {
        let precision = i32::from((word >> 24) as u8 as i8);
        let bits = [word & 63, (word >> 6) & 63, (word >> 12) & 63];
        let grid = Self {
            start,
            bits,
            precision,
        };
        let sane = (MIN_POSITION_PRECISION..=MAX_POSITION_PRECISION).contains(&precision)
            && bits.iter().all(|&b| b <= MAX_POSITION_BITS)
            && (0..3).all(|c| i64::from(start[c]) + (1i64 << bits[c]) - 1 <= i64::from(i32::MAX))
            && grid.packed() == word;
        sane.then_some(grid)
    }

    /// A cell in metres is the cell times this: the step in centimetres, `2^-precision`, times a
    /// hundredth. A power of two times a float is exact, so a decoded position is one rounding of
    /// the cell, which the GPU repeats.
    pub fn unit(&self) -> f32 {
        pow2(-self.precision) * (1.0 / CENTIMETRES_PER_METRE as f32)
    }

    /// The position, in metres, on axis `axis` of the cell `offset` above the start: its cell,
    /// converted to `f32`, times `unit` (`self.unit()`, read once by a loop).
    #[inline(always)]
    pub fn metres(&self, axis: usize, offset: u32, unit: f32) -> f32 {
        (self.start[axis] + offset as i32) as f32 * unit
    }
}

/// The cell of a position component, `metres` of the mesh's space, on the grid of `scale`
/// (`2^precision`), before it is an integer: its centimetres times the scale, plus a half, floored,
/// all in `f32`.
#[inline(always)]
pub(super) fn rounded_cell(metres: f32, scale: f32) -> f32 {
    ((metres * CENTIMETRES_PER_METRE as f32) * scale + 0.5).floor()
}

/// `values`, three floats a vertex in metres, on the grid of `2^precision` cells a centimetre.
/// Returns the page's record and, per vertex, its cell above the page's start. A page whose range
/// needs more than `MAX_POSITION_BITS` an axis says so in `bits`: its caller refuses it.
/// `#[inline(always)]`: the compiler runs it in its AVX2 copy (`simd.rs`).
#[inline(always)]
pub fn quantize_positions(values: &[f32], precision: i32) -> (PositionGrid, Vec<[u32; 3]>) {
    let scale = pow2(precision);
    let cells: Vec<[i32; 3]> = (values.as_chunks::<3>().0.iter())
        .map(|&v| v.map(|x| rounded_cell(x, scale) as i32))
        .collect();
    let (mut start, mut end) = ([i32::MAX; 3], [i32::MIN; 3]);
    for cell in &cells {
        for c in 0..3 {
            start[c] = start[c].min(cell[c]);
            end[c] = end[c].max(cell[c]);
        }
    }
    let above = |cell: i32, from: [i32; 3], c: usize| (i64::from(cell) - i64::from(from[c])) as u32;
    let bits: [u32; 3] = core::array::from_fn(|c| bits_for(above(end[c], start, c)));
    // The greatest offset the bits hold must name a cell an `i32` has, or the header's gate refuses
    // the record (`PositionGrid::unpack`): a start too near the top is lowered, the offsets grow.
    let start: [i32; 3] = core::array::from_fn(|c| {
        let room = i64::from(i32::MAX) - ((1i64 << bits[c]) - 1);
        i64::from(start[c]).min(room).max(i64::from(i32::MIN)) as i32
    });
    let offsets = (cells.iter())
        .map(|cell| core::array::from_fn(|c| above(cell[c], start, c)))
        .collect();
    (
        PositionGrid {
            start,
            bits,
            precision,
        },
        offsets,
    )
}

/// The range of a texture set's codes in a page: the least of each coordinate's codes and the
/// bits their offsets above it span.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UvRange {
    pub min: [u32; 2],
    pub bits: [u32; 2],
}

impl UvRange {
    /// The record as two words, one a coordinate: its least code above five bits of width.
    pub fn words(&self) -> [u32; 2] {
        [0, 1].map(|c| self.min[c] << 5 | self.bits[c])
    }

    /// The record read back from its words; `None` when a width is past a code's, or a code
    /// the range reaches is.
    pub fn unpack(words: [u32; 2]) -> Option<Self> {
        let range = Self {
            min: words.map(|w| w >> 5),
            bits: words.map(|w| w & 31),
        };
        let sane = (0..2).all(|c| {
            range.bits[c] <= UV_CODE_BITS
                && u64::from(range.min[c]) + (1u64 << range.bits[c]) <= 1u64 << UV_CODE_BITS
        });
        sane.then_some(range)
    }
}

/// The range of a colour's bytes in a page: the least of each channel and the bits their offsets
/// above it span. A channel of no bits is constant, its least the value.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ColorRange {
    pub min: [u32; 4],
    pub bits: [u32; 4],
}

impl ColorRange {
    /// The four least bytes in one word, red lowest.
    pub fn min_word(&self) -> u32 {
        (0..4).fold(0, |word, c| word | self.min[c] << (8 * c))
    }

    /// The four widths in sixteen bits, four a channel, red lowest.
    pub fn bits_word(&self) -> u32 {
        (0..4).fold(0, |word, c| word | self.bits[c] << (4 * c))
    }

    /// The record read back from its words (`bits_word` in its low sixteen bits); `None` when a
    /// width is past a byte's, or a byte the range reaches is.
    pub fn unpack(min_word: u32, bits_word: u32) -> Option<Self> {
        let range = Self {
            min: core::array::from_fn(|c| (min_word >> (8 * c)) & 255),
            bits: core::array::from_fn(|c| (bits_word >> (4 * c)) & 15),
        };
        let sane = (0..4).all(|c| {
            range.bits[c] <= COLOR_BITS && range.min[c] + (1 << range.bits[c]) - 1 <= COLOR_LEVELS
        });
        sane.then_some(range)
    }
}

/// The sign bit of a texture code, above its exponent and its mantissa.
const UV_SIGN_BIT: u32 = UV_EXPONENT_BITS + UV_MANTISSA_BITS;

/// A texture coordinate as its code, a float of `UV_CODE_BITS` bits whose values under 1 are
/// evenly spaced: the code's order is the value's, so the codes of a page span a range. Under 1 the
/// code is the value times `2^UV_MANTISSA_BITS`, rounded half up — the rounding may carry into the
/// code of 1 itself, which is right —; from 1 up it is the float's own exponent and mantissa
/// rounded to the mantissa's width, held to the greatest code (a magnitude of 2 147 352 576, about
/// 2.1·10⁹: a coordinate past it is stored as that one, never refused). A positive value sets the
/// sign bit; a negative one inverts the exponent and the mantissa instead.
pub fn uv_code(value: f32) -> u32 {
    let bits = value.to_bits();
    let magnitude = bits & 0x7fff_ffff;
    let unsigned = if magnitude < 0x3f80_0000 {
        let scaled = f32::from_bits(magnitude) * (1u32 << UV_MANTISSA_BITS) as f32;
        (f64::from(scaled) + 0.5) as u32
    } else {
        let shift = 23 - UV_MANTISSA_BITS;
        let rounded = (magnitude - 0x3f00_0000) + (1 << (shift - 1));
        (rounded >> shift).min((1 << UV_SIGN_BIT) - 1)
    };
    unsigned ^ ((1 << UV_SIGN_BIT) - (bits >> 31))
}

/// The coordinate a texture `code` stands for (`uv_code`): its exponent and mantissa set the float
/// from one half up, stretched so the first binade, [0.5, 1], covers [0, 1].
pub fn uv_value(code: u32) -> f32 {
    let mask = (1u32 << UV_SIGN_BIT) - 1;
    let negative = code <= mask;
    let magnitude = (if negative { !code } else { code }) & mask;
    let half_up = f32::from_bits(0x3f00_0000 + (magnitude << (23 - UV_MANTISSA_BITS)));
    let value = (half_up * 2.0 - 1.0).min(half_up);
    if negative {
        -value
    } else {
        value
    }
}

/// A colour channel as its byte: `value` held within [0, 1] — not a number reads 0 — times 255,
/// plus a half, truncated.
pub fn color_byte(value: f32) -> u32 {
    let held = if value > 0.0 { value.min(1.0) } else { 0.0 };
    (0.5 + held * COLOR_LEVELS as f32) as u32
}

/// The channel a colour `byte` stands for: its share of 255.
pub fn color_value(byte: u32) -> f32 {
    byte as f32 * (1.0 / COLOR_LEVELS as f32)
}
