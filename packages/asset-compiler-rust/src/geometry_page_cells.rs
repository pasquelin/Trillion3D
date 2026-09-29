//! The cells of a page — every vertex on every grid, from the primitive's attributes.

use crate::geometry_page::Attribute;
use crate::geometry_page_quant::{max_error, oct_encode, quantize, COLOR_EXPONENT};
use crate::{CompilerError, Result};
use std::collections::HashMap;
use trillion3d_page_codec::bits::Quant;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// The page's vertices, `width` floats each, gathered from the primitive's `source_width`-wide
/// values in local order; a missing trailing component reads 1, the alpha of a three-wide colour.
fn gather(values: &[f32], source_width: usize, width: usize, original: &[u32]) -> Result<Vec<f32>> {
    let mut out = Vec::with_capacity(original.len() * width);
    for &source in original {
        let slice = &values[source as usize * source_width..(source as usize + 1) * source_width];
        if slice.iter().any(|v| !v.is_finite()) {
            return Err(CompilerError::new(
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
    /// Rank of the vertex's deformation fields among the page's (`geometry_page_deform.rs`).
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
        return Err(CompilerError::new(
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

/// Local vertex renumbering of a page: the table and both lists start at their known final
/// size, a page carrying at most 65,535 vertices and no more corners than indices.
pub(crate) fn localise(indices: &[u32], vertices: usize) -> Result<(Vec<u32>, Vec<u32>)> {
    let bound = indices.len().min(65_535);
    let mut original = Vec::<u32>::with_capacity(bound);
    let mut remap = HashMap::<u32, u32>::with_capacity(bound);
    let mut local = Vec::<u32>::with_capacity(indices.len());
    for &source in indices {
        if source as usize >= vertices {
            return Err(CompilerError::new(
                "INVALID_PAGE",
                "Page index exceeds positions",
            ));
        }
        let id = if let Some(&id) = remap.get(&source) {
            id
        } else {
            let id = original.len();
            if id >= 65535 {
                return Err(CompilerError::new(
                    "PAGE_VERTEX_LIMIT",
                    "Page has more than 65535 vertices",
                ));
            }
            original.push(source);
            remap.insert(source, id as u32);
            id as u32
        };
        local.push(id);
    }
    Ok((original, local))
}
