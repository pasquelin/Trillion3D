//! The `WGP3` page encoder: the one that writes every page, the native compiler's and the
//! run-time cut's (`wasm/encode.rs`), from the grids of `bits` and the streams of `triangles`,
//! `positions` and `deform`: the triangles laid in strips in the order given
//! (`clusters::strip::strips_in_order`), the values of every field of the vertices laid gathered
//! (`Streams`), the page written on disk (`disk::write`) naming the vertices it lays twice
//! (`refs::alone`). The compiler then gives a streaming page's clusters their references to one
//! another and to the pages it depends on (`refs::share`).
pub mod cells;
pub mod deformation;
mod error;
mod skin;
pub mod vertices;

pub use error::{EncodeError, Result};

use cells::{grids, Cell, Grids};
use deformation::{join, page_deformation, write, Deformation};
use vertices::{first_use, localise, stored_positions};

use crate::attributes::UV_FLAGS;
use crate::bits::grid::PageGrid;
use crate::bits::PositionGrid;
use crate::clusters::strip::strips_in_order;
use crate::streams::{Page, Streams};
use crate::triangles::Spans;
use crate::writer::BitWriter;
use crate::{
    refs, Header, Layout, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, FLAG_UV, FLAG_UV1, FLAG_UV2,
    FLAG_UV3, FLAG_UV4, FLAG_UV5, FLAG_UV6, FLAG_UV7, MAX_PAGE_CORNERS, MAX_PAGE_VERTICES,
};

/// The glTF attributes every page carries when its primitive has them, in the order the page
/// writes them: the name the document gives each, its width (a colour may also be three-wide) and
/// its presence bit.
pub const PAGE_ATTRIBUTES: [(&str, usize, u32); 10] = [
    ("NORMAL", 3, FLAG_NORMAL),
    ("TEXCOORD_0", 2, FLAG_UV),
    ("TEXCOORD_1", 2, FLAG_UV1),
    ("TEXCOORD_2", 2, FLAG_UV2),
    ("TEXCOORD_3", 2, FLAG_UV3),
    ("TEXCOORD_4", 2, FLAG_UV4),
    ("TEXCOORD_5", 2, FLAG_UV5),
    ("TEXCOORD_6", 2, FLAG_UV6),
    ("TEXCOORD_7", 2, FLAG_UV7),
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

/// A written page: its bytes on disk — the page alone, naming only its own vertices —, the header
/// they open with and the box of its decoded positions, which is what the manifest says of it.
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
fn decoded_bounds(unique: &[Cell], grid: &PositionGrid) -> [[f32; 3]; 2] {
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
 * A complete, independently decodable `WGP3` page, on disk: its triangles laid in strips in the
 * order given, each vertex a strip lays once more than the primitive holds it laid again —
 * positions on the primitive's `grid`, each stored once when the vertices repeat them
 * (`stored_positions`), octahedral normals at its normal precision, texture coordinates as float
 * codes and colours as bytes, each over the page's own range, a vertex laid twice named, not
 * stored twice, and the fields of the vertices it stores each coded by its delta to the one before
 * (`disk::write`). Tangents are stored only when the attributes carry them (`TANGENT_ATTRIBUTE`),
 * each an angle around its decoded normal and a sign (`bits::tangent_code`); otherwise a reader
 * rebuilds the frame from the triangle's positions and texture coordinates. A page holds at most
 * `MAX_PAGE_TRIANGLES` triangles on `MAX_PAGE_VERTICES` vertices laid.
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
    if indices.len() > MAX_PAGE_CORNERS {
        return Err(too_large());
    }
    let vertices = positions.len() / 3;
    let (original, local) = localise(indices, vertices)?;
    let mut flags = 0u32;
    for attribute in attributes {
        let width_ok = match attribute.flag {
            FLAG_NORMAL => attribute.width == 3,
            flag if UV_FLAGS.contains(&flag) => attribute.width == 2,
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
    // The deformation's fields join each vertex's cells: two vertices merge only when they deform
    // alike.
    let mut deformed = page_deformation(deformation, &original, origin)?;
    let fields = std::mem::take(&mut deformed.fields);
    let (cells, table) = join(cells, &fields);
    flags |= deformed.flags();
    // Vertices on the same grid cells decode to the same floats: one is kept, the triangles
    // renumbered, then laid in strips in their order; a vertex out of the window of a strip is
    // laid again, a vertex of the page twice.
    let (mut unique, remap) = first_use(cells.iter().copied());
    let corners: Vec<u32> = local.iter().map(|&i| remap[i as usize]).collect();
    let mut strips = strips_in_order(&corners);
    if strips.laid.len() > MAX_PAGE_VERTICES {
        // A vertex that took the place of several keeps the laid index of the first, so a use of
        // it can fall out of a strip's window where the unmerged vertex's would not: the merge can
        // lay more vertices than the cluster did. Lay the cluster as it came, its vertices kept
        // apart — the laying the cap was checked on (`clusters::strip::constrained`).
        unique = cells;
        strips = strips_in_order(&local);
        if strips.laid.len() > MAX_PAGE_VERTICES {
            return Err(too_large());
        }
    }
    let laid: Vec<Cell> = strips.laid.iter().map(|&l| unique[l as usize]).collect();
    let bounds = decoded_bounds(&unique, &position);
    let (stored, links) = stored_positions(&laid, position.bits);
    let mut header = Header {
        vertex_count: laid.len(),
        index_count: local.len(),
        flags,
        position,
        uv: uv_records,
        color: color_record,
        normal_precision: grid.normal,
        tangent_precision: grid.tangent,
        corner_bits: Spans::of(&strips.triangles).bits,
        position_count: stored.len(),
        skin: deformed.skin.unwrap_or_default(),
        morphs: deformed.morphs.clone(),
    };
    // The skin's and the morph targets' streams, written as the resident page holds them, a row
    // for each vertex laid; each target's start, counted from the first stream of the page,
    // follows from the layout.
    let rows: Vec<&[u32]> = (laid.iter())
        .map(|cell| table[cell.extra as usize])
        .collect();
    let mut deform_words = BitWriter::default();
    write(&mut deformed, &rows, &mut deform_words);
    let skin_at = Layout::of(&header).skin;
    for (record, written) in header.morphs.iter_mut().zip(&deformed.morphs) {
        record.start = skin_at + written.start;
    }
    let has = |flag: u32| flags & flag != 0;
    let streams = Streams {
        corners: strips.triangles,
        position: core::array::from_fn(|c| stored.iter().map(|p| p[c]).collect()),
        links: links.unwrap_or_default(),
        normal: core::array::from_fn(|c| {
            if has(FLAG_NORMAL) {
                laid.iter().map(|cell| cell.normal[c]).collect()
            } else {
                Vec::new()
            }
        }),
        uv: core::array::from_fn(|set| {
            core::array::from_fn(|c| {
                if has(UV_FLAGS[set]) {
                    laid.iter().map(|cell| cell.uv[set][c]).collect()
                } else {
                    Vec::new()
                }
            })
        }),
        color: core::array::from_fn(|c| {
            if has(FLAG_COLOR) {
                laid.iter().map(|cell| cell.color[c]).collect()
            } else {
                Vec::new()
            }
        }),
        tangent: if has(FLAG_TANGENT) {
            laid.iter().map(|cell| cell.tangent).collect()
        } else {
            Vec::new()
        },
        deform: deform_words.words().to_vec(),
    };
    let page = Page {
        header,
        streams,
        strip: strips.strip,
    };
    let bytes = refs::alone(&page);
    Ok(Encoded {
        bytes,
        header: page.header,
        bounds,
    })
}

/// The refusal of a page past what the install pass transcodes: more than `MAX_PAGE_TRIANGLES`
/// triangles or `MAX_PAGE_VERTICES` vertices laid.
fn too_large() -> EncodeError {
    EncodeError::new(
        "PAGE_SIZE_LIMIT",
        "A page holds at most 128 triangles on 256 vertices laid",
    )
}
