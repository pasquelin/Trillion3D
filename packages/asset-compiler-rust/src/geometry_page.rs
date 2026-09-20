use crate::geometry_page_cells::{grids, BitWriter, Cell, Grids};
use crate::{CompilerError, Result};
use std::collections::HashMap;
use web_geometry_page_codec::{Header, Layout};
pub use web_geometry_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// One optional attribute of a primitive: its presence bit, its source width (a colour may be
/// three-wide) and its values, `width` per vertex.
pub struct Attribute {
    pub flag: u32,
    pub width: usize,
    pub values: Vec<f32>,
}

/// A written page: its bytes and what the manifest says of it.
#[derive(Debug)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub flags: u32,
    pub vertex_count: usize,
    pub decoded_bytes: usize,
    /// Largest position displacement the grid caused, in object units.
    pub quantization_error: f64,
}

/// Local vertex renumbering of page: table and both lists start at
/// known final size, page carrying at most 65,535 vertices and no more corners than
/// d'indices.
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

#[cfg(test)]
#[path = "geometry_page_tests_lotb.rs"]
mod tests_lotb;

#[cfg(test)]
#[path = "geometry_page_codec_tests.rs"]
mod tests_codec;

#[cfg(test)]
#[path = "geometry_page_codec_refus_tests.rs"]
mod tests_codec_refus;

#[cfg(test)]
#[path = "geometry_page_grid_tests.rs"]
mod tests_grid;

/**
 * A complete, independently decodable `WGP3` page: positions on the primitive grid of
 * `position_exponent`, texture coordinates on the format's grid, octahedral normals, byte colours
 * and bit-packed local indices. Tangents are never stored — a reader rebuilds them from the
 * triangle's positions and texture coordinates.
 */
pub fn encode(
    indices: &[u32],
    positions: &[f32],
    attributes: &[Attribute],
    position_exponent: i32,
) -> Result<Encoded> {
    if indices.len() < 3 || !indices.len().is_multiple_of(3) || !positions.len().is_multiple_of(3) {
        return Err(CompilerError::new(
            "INVALID_PAGE",
            "Invalid page triangle or position count",
        ));
    }
    let vertices = positions.len() / 3;
    let (original, local) = localise(indices, vertices)?;
    let mut flags = 0u32;
    for attribute in attributes {
        let width_ok = match attribute.flag {
            FLAG_NORMAL => attribute.width == 3,
            FLAG_UV | FLAG_UV1 => attribute.width == 2,
            FLAG_COLOR => attribute.width == 3 || attribute.width == 4,
            _ => false,
        };
        if !width_ok || attribute.values.len() != vertices * attribute.width {
            return Err(CompilerError::new(
                "INVALID_PAGE_ATTRIBUTE",
                "Page attribute count or layout is invalid",
            ));
        }
        flags |= attribute.flag;
    }
    let Grids {
        cells,
        position,
        uv: uv_records,
        color: color_record,
        quantization_error,
    } = grids(&original, positions, attributes, position_exponent)?;
    // Vertices on the same grid cells decode to the same floats: one copy, indices remapped.
    let mut unique = Vec::<Cell>::with_capacity(cells.len());
    let mut rank = HashMap::<Cell, u32>::with_capacity(cells.len());
    let remap: Vec<u32> = cells
        .iter()
        .map(|cell| {
            *rank.entry(*cell).or_insert_with(|| {
                unique.push(*cell);
                (unique.len() - 1) as u32
            })
        })
        .collect();
    let header = Header {
        vertex_count: unique.len(),
        index_count: local.len(),
        flags,
        position,
        uv: uv_records[0],
        uv1: uv_records[1],
        color: color_record,
        quantization_error: quantization_error as f32,
    };
    let layout = Layout::of(&header);
    let mut out = BitWriter::default();
    out.stream(local.iter().map(|&i| remap[i as usize]), layout.index_bits);
    for c in 0..3 {
        out.stream(unique.iter().map(|cell| cell.position[c]), position.bits[c]);
    }
    if flags & FLAG_NORMAL != 0 {
        out.stream(unique.iter().map(|cell| cell.normal), 16);
    }
    for (set, flag) in [FLAG_UV, FLAG_UV1].into_iter().enumerate() {
        if flags & flag != 0 {
            for c in 0..2 {
                out.stream(
                    unique.iter().map(|cell| cell.uv[set][c]),
                    uv_records[set].bits[c],
                );
            }
        }
    }
    if flags & FLAG_COLOR != 0 {
        for c in 0..4 {
            out.stream(
                unique.iter().map(|cell| cell.color[c]),
                color_record.bits[c],
            );
        }
    }
    let mut bytes = Vec::with_capacity(layout.bytes());
    for word in header.words().iter().chain(out.words()) {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    debug_assert_eq!(bytes.len(), layout.bytes());
    Ok(Encoded {
        bytes,
        flags,
        vertex_count: unique.len(),
        decoded_bytes: header.decoded_bytes(),
        quantization_error,
    })
}
