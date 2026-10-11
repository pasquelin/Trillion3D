//! The `WGP3` page encoder: the one that writes every page, the native compiler's and the
//! run-time cut's (`wasm_encode.rs`), from the grids of `bits` and the streams of `triangles`,
//! `positions` and `deform`.
pub mod cells;
pub mod deformation;
mod skin;
pub mod vertices;

use cells::{grids, Grids};
use deformation::{join, page_deformation, write, Deformation};
use vertices::{first_use, localise, stored_positions};

use crate::triangles::Spans;
use crate::writer::BitWriter;
use crate::{Header, Layout};
pub use crate::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};

/// A refusal of the encoder: a stable code and what it says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EncodeError {
    pub code: &'static str,
    pub message: &'static str,
}

impl EncodeError {
    pub const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

impl std::fmt::Display for EncodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// The encoder's result: a value or its refusal.
pub type Result<T> = std::result::Result<T, EncodeError>;

/// The glTF attributes a page may carry, in the order the page writes them: the name the
/// document gives each, its width (a colour may also be three-wide) and its presence bit.
pub const PAGE_ATTRIBUTES: [(&str, usize, u32); 4] = [
    ("NORMAL", 3, FLAG_NORMAL),
    ("TEXCOORD_0", 2, FLAG_UV),
    ("TEXCOORD_1", 2, FLAG_UV1),
    ("COLOR_0", 4, FLAG_COLOR),
];

/// One optional attribute of a primitive: its presence bit, its source width (a colour may be
/// three-wide) and its values, `width` per vertex.
#[derive(Debug, Clone)]
pub struct Attribute {
    pub flag: u32,
    pub width: usize,
    pub values: Vec<f32>,
}

/// A written page: its bytes and the header they open with, which is what the manifest says of it.
#[derive(Debug)]
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub header: Header,
}

/**
 * A complete, independently decodable `WGP3` page: positions on the primitive grid of
 * `position_exponent`, each stored once when the vertices repeat them (`stored_positions`), texture coordinates on that of `uv_exponent`, octahedral normals, byte colours
 * and local indices coded by delta within blocks of triangles. Tangents are never stored — a reader rebuilds them from the
 * triangle's positions and texture coordinates.
 */
pub fn encode(
    indices: &[u32],
    positions: &[f32],
    attributes: &[&Attribute],
    position_exponent: i32,
    uv_exponent: i32,
) -> Result<Encoded> {
    let (none, exponents) = (Deformation::default(), (position_exponent, uv_exponent));
    encode_deformed(indices, positions, attributes, (&none, &[]), exponents)
}

/// `encode`, with the joints, weights and morph targets the primitive's `deformation` carries; a
/// vertex a solved reduction placed past the source's reads the deformation of its `origin`.
pub fn encode_deformed(
    indices: &[u32],
    positions: &[f32],
    attributes: &[&Attribute],
    (deformation, origin): (&Deformation, &[u32]),
    (position_exponent, uv_exponent): (i32, i32),
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
            FLAG_UV | FLAG_UV1 => attribute.width == 2,
            FLAG_COLOR => attribute.width == 3 || attribute.width == 4,
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
    let Grids {
        cells,
        position,
        uv: uv_records,
        color: color_record,
        quantization_error,
    } = grids(
        &original,
        positions,
        attributes,
        position_exponent,
        uv_exponent,
    )?;
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
    let (stored, links) = stored_positions(&unique, position.bits);
    let mut header = Header {
        vertex_count: unique.len(),
        index_count: local.len(),
        flags,
        position,
        uv: uv_records[0],
        uv1: uv_records[1],
        color: color_record,
        quantization_error,
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
    Ok(Encoded { bytes, header })
}
