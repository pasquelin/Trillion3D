//! A vector attribute on its grid and back: the record a page carries (`Quant`), `quantize` the
//! compiler writes with, `dequant` every reader decodes with, and `quantization_error`, the bound
//! the header carries, measured with `dequant` itself.

use super::{bits_for, pow2, MAX_BITS, MAX_EXPONENT};
use trillion3d_math::aabb::extend_aabb;

/// A grid value back to its float: `min + q * step`, the product exact, the sum rounded once.
pub fn dequant(min: f32, q: u32, step: f32) -> f32 {
    min + q as f32 * step
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

/// Why a page attribute does not fit its grid.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuantRefusal {
    /// A component's range spans `2^MAX_BITS` cells or more.
    Range,
    /// The page minimum overflows an `f32`.
    Overflow,
}

/// A vector attribute on the grid of `2^exponent`: `values` holds `N` floats per vertex, each
/// divided by the step and rounded half away from zero. Returns the record and, per vertex, the
/// `N` grid offsets from the page minimum. `#[inline(always)]`: the compiler runs it in its AVX2
/// copy (`shared_math::wide`).
#[inline(always)]
pub fn quantize<const N: usize>(
    values: &[f32],
    exponent: i32,
) -> Result<(Quant<N>, Vec<[u32; N]>), QuantRefusal> {
    let count = values.len() / N;
    let step = f64::from(pow2(exponent));
    // The box grows in the pass that rounds the cells, as `aabb_of` would grow it after them.
    let (mut lo, mut hi) = ([f64::INFINITY; N], [f64::NEG_INFINITY; N]);
    let grid: Vec<[f64; N]> = (0..count)
        .map(|i| {
            let cell = core::array::from_fn(|c| (f64::from(values[i * N + c]) / step).round());
            extend_aabb(&mut lo, &mut hi, cell);
            cell
        })
        .collect();
    let range = |c: usize| hi[c] - lo[c];
    if (0..N).any(|c| range(c) >= (1u64 << MAX_BITS) as f64) {
        return Err(QuantRefusal::Range);
    }
    let bits: [u32; N] = core::array::from_fn(|c| bits_for(range(c) as u32));
    let min: [f32; N] = core::array::from_fn(|c| (lo[c] * step) as f32);
    if min.iter().any(|m| !m.is_finite()) {
        return Err(QuantRefusal::Overflow);
    }
    let offsets = grid
        .iter()
        .map(|cell| core::array::from_fn(|c| (cell[c] - lo[c]) as u32))
        .collect();
    Ok((
        Quant {
            min,
            exponent,
            bits,
        },
        offsets,
    ))
}

/// Largest distance between a source vector and its decoded value, over the page, in the units
/// of the attribute: measured with `dequant`, as the `f32` the header carries, rounded up so that
/// no displacement exceeds it. `#[inline(always)]` as `quantize`.
#[inline(always)]
pub fn quantization_error<const N: usize>(
    values: &[f32],
    record: &Quant<N>,
    offsets: &[[u32; N]],
) -> f32 {
    let step = record.step();
    let worst = offsets
        .iter()
        .enumerate()
        .map(|(i, cell)| {
            (0..N)
                .map(|c| {
                    let decoded = dequant(record.min[c], cell[c], step);
                    (f64::from(decoded) - f64::from(values[i * N + c])).powi(2)
                })
                .sum::<f64>()
                .sqrt()
        })
        .fold(0.0, f64::max);
    let rounded = worst as f32;
    if f64::from(rounded) < worst {
        rounded.next_up()
    } else {
        rounded
    }
}
