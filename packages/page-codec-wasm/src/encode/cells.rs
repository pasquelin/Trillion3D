//! The cells of a page — every vertex on every grid, from the primitive's attributes.

use super::{Attribute, EncodeError, Result};
use crate::bits::{self, Quant, QuantRefusal};
use crate::wide::wide;
use crate::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use trillion3d_math::octahedral::oct_encode;

/// Colours sit on a grid of 2^-8: 0 and 1 exact, a constant channel free.
pub const COLOR_EXPONENT: i32 = -8;

/// A vector attribute on its grid (`bits::quantize`): `values` holds `N` floats per vertex — at
/// least one, a page having at least one corner —, `exponent` is the grid the caller fixed for the
/// whole primitive and is never widened here — a page whose range needs more than `MAX_BITS` on
/// that grid is refused as `PAGE_ATTRIBUTE_RANGE`, since a page on a grid of its own would no
/// longer share its border vertices' cells with its neighbours. A loop over every vertex of every
/// page: AVX2 where the processor has it (`wide`).
fn quantize<const N: usize>(values: &[f32], exponent: i32) -> Result<(Quant<N>, Vec<[u32; N]>)> {
    wide(|| bits::quantize::<N>(values, exponent)).map_err(|refusal| match refusal {
        QuantRefusal::Range => EncodeError::new(
            "PAGE_ATTRIBUTE_RANGE",
            "Page attribute range exceeds 2^24 steps of its primitive grid",
        ),
        QuantRefusal::Overflow => EncodeError::new(
            "INVALID_PAGE_ATTRIBUTE",
            "Page attribute minimum overflows a float",
        ),
    })
}

/// The error bound a page header carries (`bits::quantization_error`), AVX2 where the processor
/// has it, as `quantize`.
fn max_error<const N: usize>(values: &[f32], record: &Quant<N>, offsets: &[[u32; N]]) -> f32 {
    wide(|| bits::quantization_error::<N>(values, record, offsets))
}

/// The page's vertices, `width` floats each, gathered from the primitive's `source_width`-wide
/// values in local order; a missing trailing component reads 1, the alpha of a three-wide colour.
fn gather(values: &[f32], source_width: usize, width: usize, original: &[u32]) -> Result<Vec<f32>> {
    let mut out = Vec::with_capacity(original.len() * width);
    for &source in original {
        let slice = &values[source as usize * source_width..(source as usize + 1) * source_width];
        if slice.iter().any(|v| !v.is_finite()) {
            return Err(EncodeError::new(
                "INVALID_PAGE_ATTRIBUTE",
                "Nonfinite page attribute",
            ));
        }
        out.extend_from_slice(slice);
        out.resize(out.len() + width - source_width, 1.0);
    }
    Ok(out)
}

/// A vertex once on every grid: two vertices that quantize alike decode alike, so one is kept.
#[derive(Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct Cell {
    pub position: [u32; 3],
    pub normal: u32,
    pub uv: [[u32; 2]; 2],
    pub color: [u32; 4],
    /// Rank of the vertex's deformation fields among the page's (`deform.rs`).
    pub extra: u32,
}

/// The page's cells with the records that describe their grids and the position error.
pub struct Grids {
    pub cells: Vec<Cell>,
    pub position: Quant<3>,
    pub uv: [Quant<2>; 2],
    pub color: Quant<4>,
    pub quantization_error: f32,
}

/// Every vertex of `original` on its grids: positions on `position_exponent`, texture
/// coordinates on `uv_exponent`, colours on the format's own, normals octahedral.
pub fn grids(
    original: &[u32],
    positions: &[f32],
    attributes: &[&Attribute],
    position_exponent: i32,
    uv_exponent: i32,
) -> Result<Grids> {
    let by_flag = |flag: u32| attributes.iter().find(|a| a.flag == flag);
    let page_positions = gather(positions, 3, 3, original)?;
    let (position, position_cells) = quantize::<3>(&page_positions, position_exponent)?;
    let quantization_error = max_error(&page_positions, &position, &position_cells);
    if !quantization_error.is_finite() {
        return Err(EncodeError::new(
            "INVALID_PAGE_ATTRIBUTE",
            "Page positions span more than a float can measure",
        ));
    }
    let mut cells = vec![Cell::default(); original.len()];
    for (cell, p) in cells.iter_mut().zip(&position_cells) {
        cell.position = *p;
    }
    if let Some(a) = by_flag(FLAG_NORMAL) {
        let normals = gather(&a.values, 3, 3, original)?;
        for (i, cell) in cells.iter_mut().enumerate() {
            cell.normal = oct_encode([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
        }
    }
    let mut uv_records = [Quant::<2>::flat(uv_exponent); 2];
    for (set, flag) in [FLAG_UV, FLAG_UV1].into_iter().enumerate() {
        if let Some(a) = by_flag(flag) {
            let (quant, uv_cells) =
                quantize::<2>(&gather(&a.values, 2, 2, original)?, uv_exponent)?;
            uv_records[set] = quant;
            for (cell, q) in cells.iter_mut().zip(uv_cells) {
                cell.uv[set] = q;
            }
        }
    }
    let mut color_record = Quant::<4>::flat(COLOR_EXPONENT);
    if let Some(a) = by_flag(FLAG_COLOR) {
        // Channels clamped to [0, 1]; a three-wide colour takes alpha 1.
        let mut rgba = gather(&a.values, a.width, 4, original)?;
        for channel in &mut rgba {
            *channel = channel.clamp(0.0, 1.0);
        }
        let (quant, color_cells) = quantize::<4>(&rgba, COLOR_EXPONENT)?;
        color_record = quant;
        for (cell, q) in cells.iter_mut().zip(color_cells) {
            cell.color = q;
        }
    }
    Ok(Grids {
        cells,
        position,
        uv: uv_records,
        color: color_record,
        quantization_error,
    })
}

#[cfg(test)]
#[path = "wide_tests.rs"]
mod wide_tests;
