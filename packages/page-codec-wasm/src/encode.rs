//! The `WGP3` page encoder: the one that writes every page, the native compiler's and the
//! run-time cut's (`wasm/encode.rs`), from the grids of `bits` and the streams of `triangles`,
//! `positions` and `deform`.
pub mod cells;
pub mod deformation;
mod error;
mod skin;
pub mod vertices;

pub use error::{EncodeError, Result};

use cells::{grids, Grids};
use deformation::{join, page_deformation, write, Deformation};
use vertices::{first_use, localise, stored_positions};

use crate::attributes::UV_FLAGS;
use crate::bits::grid::PageGrid;
use crate::bits::PositionGrid;
use crate::triangles::Spans;
use crate::writer::BitWriter;
use crate::{
    Header, Layout, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, FLAG_UV, FLAG_UV1, FLAG_UV2, FLAG_UV3,
};

/// The glTF attributes every page carries when its primitive has them, in the order the page
/// writes them: the name the document gives each, its width (a colour may also be three-wide) and
/// its presence bit.
pub const PAGE_ATTRIBUTES: [(&str, usize, u32); 6] = [
    ("NORMAL", 3, FLAG_NORMAL),
    ("TEXCOORD_0", 2, FLAG_UV),
    ("TEXCOORD_1", 2, FLAG_UV1),
    ("TEXCOORD_2", 2, FLAG_UV2),
    ("TEXCOORD_3", 2, FLAG_UV3),
    ("COLOR_0", 4, FLAG_COLOR),
];
/// The glTF attribute a page carries beside `PAGE_ATTRIBUTES` only when its mesh stores its
/// tangents (`FLAG_TANGENT`), written after them: the direction and the bitangent's sign.
pub const TANGENT_ATTRIBUTE: (&str, usize, u32) = ("TANGENT", 4, FLAG_TANGENT);

/// One optional attribute of a primitive: its presence bit, its source width (a colour may be
/// three-wide) and its values, `width` per vertex.
#[derive(Debug, Clone)]
pub struct Attribute {
    pub flag: u32,
    pub width: usize,
    pub values: Vec<f32>,
}

/// A written page: its bytes, the header they open with and the box of its decoded positions,
/// which is what the manifest says of it.
#[derive(Debug)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub header: Header,
    /// The box of the positions its vertices decode to, `[low, high]` in metres: the bounds of a
    /// page, as a reader draws it.
    pub bounds: [[f32; 3]; 2],
}

/// The box of the positions `unique` vertices decode to on `grid` (`PositionGrid::metres`: a
/// cell's float grows with the cell, so the extreme cells give the extreme floats).
fn decoded_bounds(unique: &[cells::Cell], grid: &PositionGrid) -> [[f32; 3]; 2] {
    let unit = grid.unit();
    let extreme = |pick: fn(u32, u32) -> u32, empty: u32| {
        core::array::from_fn(|c| {
            let cell = unique.iter().map(|v| v.position[c]).fold(empty, pick);
            grid.metres(c, cell, unit)
        })
    };
    [extreme(u32::min, u32::MAX), extreme(u32::max, 0)]
}

/**
 * A complete, independently decodable `WGP3` page: positions on the primitive's `grid`, each stored
 * once when the vertices repeat them (`stored_positions`), octahedral normals at its normal
 * precision, texture coordinates as float codes and colours as bytes, each over the page's own
 * range, and local indices coded by delta within blocks of triangles. Tangents are stored only
 * when the attributes carry them (`TANGENT_ATTRIBUTE`), each an angle around its decoded normal
 * and a sign (`bits::tangent_code`); otherwise a reader rebuilds the frame from the triangle's
 * positions and texture coordinates.
 */
pub fn encode(
    indices: &[u32],
    positions: &[f32],
    attributes: &[&Attribute],
    grid: PageGrid,
) -> Result<Encoded> {
    let none = Deformation::default();
    encode_deformed(indices, positions, attributes, (&none, &[]), grid)
}

/// `encode`, with the joints, weights and morph targets the primitive's `deformation` carries; a
/// vertex a solved reduction placed past the source's reads the deformation of its `origin`.
pub fn encode_deformed(
    indices: &[u32],
    positions: &[f32],
    attributes: &[&Attribute],
    (deformation, origin): (&Deformation, &[u32]),
    grid: PageGrid,
) -> Result<Encoded> {
    if indices.len() < 3 || !indices.len().is_multiple_of(3) || !positions.len().is_multiple_of(3) {
        return Err(EncodeError::new(
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
            FLAG_UV | FLAG_UV1 | FLAG_UV2 | FLAG_UV3 => attribute.width == 2,
            FLAG_COLOR => attribute.width == 3 || attribute.width == 4,
            FLAG_TANGENT => attribute.width == 4,
            _ => false,
        };
        if !width_ok || attribute.values.len() != vertices * attribute.width {
            return Err(EncodeError::new(
                "INVALID_PAGE_ATTRIBUTE",
                "Page attribute count or layout is invalid",
            ));
        }
        flags |= attribute.flag;
    }
    // A stored tangent is an angle around its vertex's normal: no normal, nothing to turn around.
    if flags & FLAG_TANGENT != 0 && flags & FLAG_NORMAL == 0 {
        return Err(EncodeError::new(
            "INVALID_PAGE_ATTRIBUTE",
            "Page tangents need the page's normals",
        ));
    }
    let Grids {
        cells,
        position,
        uv: uv_records,
        color: color_record,
    } = grids(&original, positions, attributes, grid)?;
    // The deformation's fields join each vertex's cells: two vertices merge only when they
    // deform alike.
    let mut deformed = page_deformation(deformation, &original, origin)?;
    let fields = std::mem::take(&mut deformed.fields);
    let (cells, table) = join(cells, &fields);
    flags |= deformed.flags();
    // Vertices on the same grid cells decode to the same floats: one copy, indices remapped.
    let (unique, remap) = first_use(cells.iter().copied());
    let corners: Vec<u32> = local.iter().map(|&i| remap[i as usize]).collect();
    let spans = Spans::of(&corners);
    let bounds = decoded_bounds(&unique, &position);
    let (stored, links) = stored_positions(&unique, position.bits);
    let mut header = Header {
        vertex_count: unique.len(),
        index_count: local.len(),
        flags,
        position,
        uv: uv_records,
        color: color_record,
        normal_precision: grid.normal,
        tangent_precision: grid.tangent,
        corner_bits: spans.bits,
        position_count: stored.len(),
        skin: deformed.skin.unwrap_or_default(),
        morphs: deformed.morphs.clone(),
    };
    let layout = Layout::of(&header);
    let mut out = BitWriter::default();
    spans.write(&mut out, &corners, &layout.corners);
    for c in 0..3 {
        out.stream(stored.iter().map(|p| p[c]), position.bits[c]);
    }
    if let Some(links) = links {
        out.stream(links.into_iter(), header.link_bits());
    }
    if flags & FLAG_NORMAL != 0 {
        for c in 0..2 {
            out.stream(unique.iter().map(|cell| cell.normal[c]), grid.normal);
        }
    }
    for (set, flag) in UV_FLAGS.into_iter().enumerate() {
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
    if flags & FLAG_TANGENT != 0 {
        out.stream(unique.iter().map(|cell| cell.tangent), grid.tangent + 1);
    }
    let rows: Vec<&[u32]> = (unique.iter())
        .map(|cell| table[cell.extra as usize])
        .collect();
    write(&mut deformed, &rows, &mut out);
    header.morphs = deformed.morphs;
    let mut bytes = Vec::with_capacity(layout.bytes());
    for word in header.words().iter().chain(out.words()) {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    debug_assert_eq!(bytes.len(), layout.bytes());
    Ok(Encoded {
        bytes,
        header,
        bounds,
    })
}
