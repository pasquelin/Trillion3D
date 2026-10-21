//! The cells of a page — every vertex on every grid, from the primitive's attributes.

use super::{Attribute, EncodeError, Result};
use crate::attributes::UV_FLAGS;
use crate::bits::grid::PageGrid;
use crate::bits::{
    bits_for, color_byte, normal_code, normal_decode, quantize_positions, tangent_code, uv_code,
    ColorRange, PositionGrid, UvRange,
};
use crate::simd::dispatch;
use crate::{
    COLOR_LEVELS, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, MAX_POSITION_BITS, MAX_UV_SETS,
    UV_CODE_BITS,
};

/// The page's positions on the precision grid (`bits::quantize_positions`): `values` holds three
/// floats per vertex — at least one, a page having at least one corner —, `precision` is the grid
/// the caller fixed for the whole primitive and is never widened here — a page whose range needs
/// more than `MAX_POSITION_BITS` on that grid is refused as `PAGE_ATTRIBUTE_RANGE`, since a page on
/// a grid of its own would no longer share its border vertices' cells with its neighbours. A loop
/// over every vertex of every page: AVX2 where the processor has it (`simd::dispatch`).
fn quantize(values: &[f32], precision: i32) -> Result<(PositionGrid, Vec<[u32; 3]>)> {
    let (grid, offsets) = dispatch(|| quantize_positions(values, precision));
    if grid.bits.iter().any(|&bits| bits > MAX_POSITION_BITS) {
        return Err(EncodeError::new(
            "PAGE_ATTRIBUTE_RANGE",
            "Page positions span more cells than a page holds on its primitive grid",
        ));
    }
    Ok((grid, offsets))
}

/// The record of each component of `codes`, none above `last`: the bits the offsets above the least
/// code span, the `min` they are counted from, and the offsets. The greatest offset those bits hold
/// must still name a code `last` allows — the header's gate refuses any other record
/// (`ColorRange::unpack`, `UvRange::unpack`) —, so a `min` that would let it reach past is lowered
/// to `last + 1 − 2^bits`: the same bits still span every code, the offsets grow by the same step,
/// and a vertex decodes to the code it was given.
fn ranged<const N: usize>(codes: &[[u32; N]], last: u32) -> ([u32; N], [u32; N], Vec<[u32; N]>) {
    let of = |c: usize| codes.iter().map(move |code| code[c]);
    let least: [u32; N] = core::array::from_fn(|c| of(c).min().unwrap_or(0));
    let bits: [u32; N] = core::array::from_fn(|c| bits_for(of(c).max().unwrap_or(0) - least[c]));
    let min: [u32; N] = core::array::from_fn(|c| least[c].min(last + 1 - (1 << bits[c])));
    let offsets = (codes.iter())
        .map(|code| core::array::from_fn(|c| code[c] - min[c]))
        .collect();
    (min, bits, offsets)
}

/// The page's vertices, `width` floats each, gathered from the primitive's `source_width`-wide
/// values in local order; a missing trailing component reads 1, the alpha of a three-wide colour.
/// A value that is not finite refuses the page: no decoder would read it back.
pub(super) fn gather(
    values: &[f32],
    source_width: usize,
    width: usize,
    original: &[u32],
) -> Result<Vec<f32>> {
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
    pub normal: [u32; 2],
    pub uv: [[u32; 2]; MAX_UV_SETS],
    pub color: [u32; 4],
    /// The stored tangent's code (`bits::tangent_code`), zero on a page that stores none.
    pub tangent: u32,
    /// Rank of the vertex's deformation fields among the page's (`deform.rs`).
    pub extra: u32,
}

/// The page's cells with the records that describe their grids.
pub struct Grids {
    pub cells: Vec<Cell>,
    pub position: PositionGrid,
    pub uv: [UvRange; MAX_UV_SETS],
    pub color: ColorRange,
}

/// Every vertex of `original` on its grids: positions on the primitive's `grid`, normals on the
/// octahedron of its normal precision, texture coordinates as float codes, colours as bytes,
/// tangents by their angle around the normal each decodes to at its tangent precision
/// (`bits::tangent_code`) — a vertex whose tangent names no angle repeating the code of the vertex
/// before it, the first one zero.
pub fn grids(
    original: &[u32],
    positions: &[f32],
    attributes: &[&Attribute],
    grid: PageGrid,
) -> Result<Grids> {
    let by_flag = |flag: u32| attributes.iter().find(|a| a.flag == flag);
    let page_positions = gather(positions, 3, 3, original)?;
    let (position, position_cells) = quantize(&page_positions, grid.position)?;
    let mut cells = vec![Cell::default(); original.len()];
    for (cell, p) in cells.iter_mut().zip(&position_cells) {
        cell.position = *p;
    }
    if let Some(a) = by_flag(FLAG_NORMAL) {
        let normals = gather(&a.values, 3, 3, original)?;
        for (cell, n) in cells.iter_mut().zip(normals.as_chunks::<3>().0) {
            cell.normal = normal_code(*n, grid.normal);
        }
    }
    let mut uv_records = [UvRange::default(); MAX_UV_SETS];
    for (set, flag) in UV_FLAGS.into_iter().enumerate() {
        if let Some(a) = by_flag(flag) {
            let values = gather(&a.values, 2, 2, original)?;
            let codes: Vec<[u32; 2]> = (values.as_chunks::<2>().0.iter())
                .map(|&uv| uv.map(uv_code))
                .collect();
            let (min, bits, offsets) = ranged(&codes, (1 << UV_CODE_BITS) - 1);
            uv_records[set] = UvRange { min, bits };
            for (cell, q) in cells.iter_mut().zip(offsets) {
                cell.uv[set] = q;
            }
        }
    }
    let mut color_record = ColorRange::default();
    if let Some(a) = by_flag(FLAG_COLOR) {
        // A three-wide colour takes alpha 1.
        let rgba = gather(&a.values, a.width, 4, original)?;
        let bytes: Vec<[u32; 4]> = (rgba.as_chunks::<4>().0.iter())
            .map(|&channels| channels.map(color_byte))
            .collect();
        let (min, bits, offsets) = ranged(&bytes, COLOR_LEVELS);
        color_record = ColorRange { min, bits };
        for (cell, q) in cells.iter_mut().zip(offsets) {
            cell.color = q;
        }
    }
    if let Some(a) = by_flag(FLAG_TANGENT) {
        let tangents = gather(&a.values, 4, 4, original)?;
        let mut code = 0;
        for (cell, t) in cells.iter_mut().zip(tangents.as_chunks::<4>().0) {
            let normal = normal_decode(cell.normal, grid.normal);
            code = tangent_code([t[0], t[1], t[2]], t[3], normal, grid.tangent).unwrap_or(code);
            cell.tangent = code;
        }
    }
    Ok(Grids {
        cells,
        position,
        uv: uv_records,
        color: color_record,
    })
}

#[cfg(test)]
mod tests;
