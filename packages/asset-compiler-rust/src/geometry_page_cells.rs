//! The cells of a page — every vertex on every grid, from the primitive's attributes — and the
//! bit writer that packs them.

use crate::geometry_page::Attribute;
use crate::geometry_page_quant::{max_error, oct_encode, quantize, COLOR_EXPONENT, UV_EXPONENT};
use crate::{CompilerError, Result};
use web_geometry_page_codec::bits::Quant;
use web_geometry_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// The page's vertices, `width` floats each, gathered from the primitive in local order.
fn gather(values: &[f32], width: usize, original: &[u32]) -> Result<Vec<f32>> {
    let mut out = Vec::with_capacity(original.len() * width);
    for &source in original {
        let slice = &values[source as usize * width..(source as usize + 1) * width];
        if slice.iter().any(|v| !v.is_finite()) {
            return Err(CompilerError::new(
                "INVALID_PAGE_ATTRIBUTE",
                "Nonfinite page attribute",
            ));
        }
        out.extend_from_slice(slice);
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
}

/// The page's cells with the records that describe their grids and the position error.
pub struct Grids {
    pub cells: Vec<Cell>,
    pub position: Quant<3>,
    pub uv: [Quant<2>; 2],
    pub color: Quant<4>,
    pub quantization_error: f64,
}

/// Every vertex of `original` on its grids: positions on `position_exponent`, texture
/// coordinates and colours on the format's own, normals octahedral.
pub fn grids(
    original: &[u32],
    positions: &[f32],
    attributes: &[&Attribute],
    position_exponent: i32,
) -> Result<Grids> {
    let by_flag = |flag: u32| attributes.iter().find(|a| a.flag == flag);
    let page_positions = gather(positions, 3, original)?;
    let (position, position_cells) = quantize::<3>(&page_positions, position_exponent)?;
    let quantization_error = max_error(&page_positions, &position, &position_cells);
    if !(quantization_error as f32).is_finite() {
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
        let normals = gather(&a.values, 3, original)?;
        for (i, cell) in cells.iter_mut().enumerate() {
            cell.normal = oct_encode([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
        }
    }
    let mut uv_records = [Quant::<2>::flat(UV_EXPONENT); 2];
    for (set, flag) in [FLAG_UV, FLAG_UV1].into_iter().enumerate() {
        if let Some(a) = by_flag(flag) {
            let (quant, uv_cells) = quantize::<2>(&gather(&a.values, 2, original)?, UV_EXPONENT)?;
            uv_records[set] = quant;
            for (cell, q) in cells.iter_mut().zip(uv_cells) {
                cell.uv[set] = q;
            }
        }
    }
    let mut color_record = Quant::<4>::flat(COLOR_EXPONENT);
    if let Some(a) = by_flag(FLAG_COLOR) {
        // Channels clamped to [0, 1]; a three-wide colour takes alpha 1.
        let colors = gather(&a.values, a.width, original)?;
        let rgba: Vec<f32> = (0..original.len() * 4)
            .map(|k| {
                let (i, c) = (k / 4, k % 4);
                if c < a.width {
                    colors[i * a.width + c].clamp(0.0, 1.0)
                } else {
                    1.0
                }
            })
            .collect();
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

/// Packs fixed-width fields, least significant bit first, into little-endian words. Every
/// stream starts on a word: `stream` closes the last one it wrote.
#[derive(Default)]
pub struct BitWriter {
    words: Vec<u32>,
    bit: usize,
}

impl BitWriter {
    pub fn push(&mut self, value: u32, bits: u32) {
        if bits == 0 {
            return;
        }
        let shift = (self.bit % 32) as u32;
        if shift == 0 {
            self.words.push(0);
        }
        let index = self.words.len() - 1;
        self.words[index] |= value << shift;
        if shift + bits > 32 {
            self.words.push(value >> (32 - shift));
        }
        self.bit += bits as usize;
    }

    /// One whole stream: its fields, then the padding that closes the last word.
    pub fn stream(&mut self, values: impl Iterator<Item = u32>, bits: u32) {
        for value in values {
            self.push(value, bits);
        }
        self.bit = self.words.len() * 32;
    }

    pub fn words(&self) -> &[u32] {
        &self.words
    }
}
