//! Binary sidecar of the cluster manifest.
//!
//! A cache describes tens of thousands of clusters with a dozen numbers each. Written as JSON the
//! browser has to tokenize tens of megabytes before the first frame; written as typed-array columns
//! it is a single `fetch` and a handful of views. `split` cuts a finished manifest in two: the
//! small JSON a reader parses, and the columns it maps.
//!
//! Layout, little-endian, mirrored byte for byte by `packages/sdk-core/manifestBinary.ts`:
//!
//!   u32 magic 'WGMB' · u32 version · u32 columnCount · u32 reserved
//!   columnCount × (u32 byteOffset, u32 byteLength)
//!   column payloads, each starting on an 8-byte boundary
use crate::texture_preview::{
    preview_block_bytes, preview_first_level, preview_level_count, preview_pixel_bytes,
    TexturePreview,
};
use crate::{CompilerError, Result};
use serde_json::{json, Map, Value};

mod digests;
pub(crate) mod format;
mod page;
mod preview;
#[cfg(test)]
mod preview_tests;
mod primitive;
#[cfg(test)]
mod tests;
pub use digests::{digests, texture_digests, texture_levels, BakedLevels};
use format::*;

/// Version 4 turns the fixed 16×16 preview entries into the variable progressive levels: the pixel
/// column is no longer one stride per entry, and an entry carries its own byte range. A reader of
/// version 3 would slice the wrong texture's levels, so it refuses this file outright.
/// Version 5 widens an entry from ten to twelve words — the atlas it serves and the number of
/// levels baked as files under `textures/` — and its pixels follow the graphics card's mip rule.
/// A reader of version 4 would stride through the entries wrongly, so it refuses this file.
/// Version 6 names the quantized cluster page (`WGP3`) as the only geometry page. Version 7 adds
/// a layout word per block family to the entry and two columns of block-compressed tails, the
/// BC family then ASTC; a reader of version 6 would not know them, so it refuses.
pub const MANIFEST_BINARY_VERSION: u32 = 7;
/// 'W','G','M','B' read as a little-endian u32.
pub const MANIFEST_BINARY_MAGIC: u32 = 0x424d_4757;
const HEADER_WORDS: usize = 4;

const PAGE_BOUNDS: usize = 0;
const PAGE_SPHERE: usize = 1;
const PAGE_PARENT_SPHERE: usize = 2;
const PAGE_ERROR: usize = 3;
const PAGE_INT: usize = 4;
const PAGE_U32: usize = 5;
const PAGE_SHA: usize = 6;
const GEOMETRY_SHA: usize = 7;
const GEOMETRY_U32: usize = 8;
const CULLING_NODES: usize = 9;
const GROUP_LEVEL: usize = 10;
const GROUP_ERROR: usize = 11;
const GROUP_SPHERE: usize = 12;
const GROUP_CHILD_COUNT: usize = 13;
const GROUP_CHILD: usize = 14;
const GROUP_OUTPUT_COUNT: usize = 15;
const GROUP_OUTPUT: usize = 16;
const STRUCTURE_ROOT: usize = 17;
const BUNDLE_U32: usize = 18;
const BUNDLE_SHA: usize = 19;
const PAGE_DEPTH_LAYER: usize = 20;
const TEXTURE_PREVIEW_U32: usize = 21;
const TEXTURE_PREVIEW_SHA: usize = 22;
const TEXTURE_PREVIEW_PIXELS: usize = 23;
/// The tails block-compressed, one column per family in `BlockFormat::ALL` order.
const TEXTURE_PREVIEW_BLOCKS: [usize; 2] = [24, 25];
const COLUMNS: usize = 26;
/// Numbers per level entry: texture, image, width, height, kind and provenance
/// view, then the first carried level, their count, the start and length of its
/// pixels, the atlas it serves, the count of levels baked as files, and the
/// layout word of each family — 0 when the chain stays lossless there.
const PREVIEW_WORDS: usize = 14;
/// Ranks, in an entry, of the words the level reader and the proof come back for.
const PREVIEW_FIRST_LEVEL: usize = 6;
const PREVIEW_KIND: usize = 10;
const PREVIEW_BAKED: usize = 11;
const PREVIEW_LAYOUTS: usize = 12;

/// A digest as the columns and the object store spell it: 64 lowercase
/// hexadecimal characters, and nothing a path could be made of.
pub fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Bytes a page writes in each page column, whichever the page.
const PAGE_COLUMN_WIDTHS: [(usize, usize); 10] = [
    (PAGE_BOUNDS, 48),
    (PAGE_SPHERE, 32),
    (PAGE_PARENT_SPHERE, 32),
    (PAGE_ERROR, 16),
    (PAGE_INT, 32),
    (PAGE_U32, 8),
    (PAGE_SHA, 64),
    (GEOMETRY_SHA, 64),
    (GEOMETRY_U32, 20),
    (PAGE_DEPTH_LAYER, 4),
];

const FLAG_ROLE: u32 = 1;
const FLAG_COARSE: u32 = 2;
const FLAG_GEOMETRY: u32 = 4;
const FLAG_CLUSTER_ERROR: u32 = 8;
const FLAG_PARENT_ERROR: u32 = 16;
const FLAG_PARENT_ERROR_FINITE: u32 = 32;
const FLAG_PARENT_SPHERE: u32 = 64;
const FLAG_PARENT_SPHERE_SET: u32 = 128;
const FLAG_GROUP: u32 = 256;
const FLAG_SOURCE: u32 = 512;

/// Object naming templates of a cache. `{sha}` stands for the 64 hexadecimal digest characters.
pub struct Templates<'a> {
    pub binary: &'a str,
    pub page: &'a str,
    pub geometry: &'a str,
    pub bundle: &'a str,
}

/// Splits a finished manifest into the small JSON and the columns. The returned descriptor carries
/// an empty `sha256`: only the caller, holding the finished bytes, can hash them.
pub fn split(
    manifest: &Value,
    templates: &Templates,
    previews: &[TexturePreview],
) -> Result<(Value, Vec<u8>)> {
    let root = object(manifest, "manifest")?;
    let primitives = array(
        root.get("primitives")
            .ok_or_else(|| bad("manifest.primitives is absent"))?,
        "manifest.primitives",
    )?;
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    // Page columns have a fixed width: a page always writes the same number of
    // bytes, so the total is known before the first write.
    let pages_total = primitives
        .iter()
        .filter_map(|primitive| primitive.get("pages").and_then(Value::as_array))
        .map(Vec::len)
        .sum::<usize>();
    for (index, per_page) in PAGE_COLUMN_WIDTHS {
        columns[index].reserve(pages_total * per_page);
    }
    let mut slim_primitives = Vec::with_capacity(primitives.len());
    for primitive in primitives {
        let entry = object(primitive, "primitive")?;
        let pages = array(
            entry
                .get("pages")
                .ok_or_else(|| bad("primitive.pages is absent"))?,
            "primitive.pages",
        )?;
        for page in pages {
            page::encode_page(page, &mut columns, templates)?;
        }
        slim_primitives.push(primitive::encode_primitive(
            entry,
            pages.len(),
            &mut columns,
            templates,
        )?);
    }
    preview::encode_previews(previews, &mut columns)?;
    // The pixel and block columns have no fixed stride: their total lengths enter the small
    // JSON, without which a reader would not know how many bytes a column must be before
    // reading it.
    let preview_bytes = columns[TEXTURE_PREVIEW_PIXELS].bytes.len();
    let [bc7_bytes, astc_bytes] = TEXTURE_PREVIEW_BLOCKS.map(|column| columns[column].bytes.len());
    let header_bytes = (HEADER_WORDS + COLUMNS * 2) * 4;
    let mut offsets = [0u32; COLUMNS];
    let mut offset = (header_bytes + 7) & !7;
    for index in 0..COLUMNS {
        offsets[index] =
            u32::try_from(offset).map_err(|_| bad("Manifest binary exceeds four gigabytes"))?;
        offset = (offset + columns[index].bytes.len() + 7) & !7;
    }
    let mut bytes = vec![0u8; offset];
    bytes[0..4].copy_from_slice(&MANIFEST_BINARY_MAGIC.to_le_bytes());
    bytes[4..8].copy_from_slice(&MANIFEST_BINARY_VERSION.to_le_bytes());
    bytes[8..12].copy_from_slice(&(COLUMNS as u32).to_le_bytes());
    for index in 0..COLUMNS {
        let at = (HEADER_WORDS + index * 2) * 4;
        bytes[at..at + 4].copy_from_slice(&offsets[index].to_le_bytes());
        bytes[at + 4..at + 8].copy_from_slice(&(columns[index].bytes.len() as u32).to_le_bytes());
        let start = offsets[index] as usize;
        bytes[start..start + columns[index].bytes.len()].copy_from_slice(&columns[index].bytes);
    }
    let mut slim = root.clone();
    slim.insert("primitives".into(), Value::Array(slim_primitives));
    slim.insert("binary".into(),json!({"version":MANIFEST_BINARY_VERSION,"url":templates.binary,"sha256":"","bytes":bytes.len(),
  "pageUrl":templates.page,"geometryUrl":templates.geometry,"bundleUrl":templates.bundle,"texturePreviews":previews.len(),
  "texturePreviewBytes":preview_bytes,"texturePreviewBc7Bytes":bc7_bytes,"texturePreviewAstcBytes":astc_bytes}));
    Ok((Value::Object(slim), bytes))
}
