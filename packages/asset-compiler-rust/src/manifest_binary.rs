//! Binary sidecar of the cluster manifest.
//!
//! A cache describes tens of thousands of clusters with a dozen numbers each. Written as JSON the
//! browser has to tokenize tens of megabytes before the first frame; written as typed-array columns
//! it is a single `fetch` and a handful of views. `columns` cuts one page of a manifest in two: the
//! small JSON a reader parses, and the columns it maps.
//!
//! Layout, little-endian, mirrored byte for byte by `packages/sdk-core/src/manifest/binaryDecode.ts`:
//!
//!   u32 magic 'WGMB' · u32 version · u32 columnCount · u32 reserved
//!   columnCount × (u32 byteOffset, u32 byteLength)
//!   column payloads, each starting on an 8-byte boundary
use crate::texture::{
    preview_first_level, preview_layout_bytes, preview_level_count, preview_pixel_bytes,
    TexturePreview, FAMILIES,
};
use crate::Result;
use serde_json::{json, Map, Value};

mod digests;
pub(crate) mod format;
mod laid;
mod page;
mod preview;
mod primitive;
#[cfg(test)]
mod tests;
mod version;
pub use digests::{texture_levels, BakedLevels};
use format::*;
#[cfg(test)]
use tests::split;
pub use version::*;

const PAGE_BOUNDS: usize = 0;
const PAGE_SPHERE: usize = 1;
const PAGE_PARENT_SPHERE: usize = 2;
const PAGE_ERROR: usize = 3;
const PAGE_INT: usize = 4;
const PAGE_U32: usize = 5;
const GEOMETRY_U32: usize = 6;
const CULLING_NODES: usize = 7;
const GROUP_LEVEL: usize = 8;
const GROUP_ERROR: usize = 9;
const GROUP_SPHERE: usize = 10;
const GROUP_CHILD_COUNT: usize = 11;
const GROUP_CHILD: usize = 12;
const GROUP_OUTPUT_COUNT: usize = 13;
const GROUP_OUTPUT: usize = 14;
const STRUCTURE_ROOT: usize = 15;
const BUNDLE_U32: usize = 16;
const BUNDLE_SHA: usize = 17;
const PAGE_DEPTH_LAYER: usize = 18;
const TEXTURE_PREVIEW_U32: usize = 19;
const TEXTURE_PREVIEW_SHA: usize = 20;
const TEXTURE_PREVIEW_PIXELS: usize = 21;
/// The tails block-compressed, one column per family in `BlockFormat::ALL` order.
const TEXTURE_PREVIEW_BLOCKS: [usize; FAMILIES] = [22, 23, 24];
const BUNDLE_DEPENDENCY_COUNT: usize = 25;
const BUNDLE_DEPENDENCY: usize = 26;
const COLUMNS: usize = 27;
/// Numbers per level entry: texture, image, width, height, kind and provenance
/// view, then the first carried level, their count, the start and length of its
/// pixels, the atlas it serves, the count of levels baked as files, and the
/// layout word of each family — 0 when the chain stays lossless there.
const PREVIEW_WORDS: usize = PREVIEW_LAYOUTS + FAMILIES;
/// Ranks, in an entry, of the words the level reader and the proof come back for.
const PREVIEW_FIRST_LEVEL: usize = 6;
const PREVIEW_KIND: usize = 10;
const PREVIEW_BAKED: usize = 11;
const PREVIEW_LAYOUTS: usize = 12;

/// A digest as the columns and the object store spell it: 64 lowercase
/// hexadecimal characters, and nothing a path could be made of.
pub fn is_digest(value: &str) -> bool {
    value.len() == 64 && is_lower_hex(value)
}

/// Whether `value` is lowercase hexadecimal only, as a digest and a page slot are spelled.
pub(crate) fn is_lower_hex(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Bytes a page writes in each page column, whichever the page.
const PAGE_COLUMN_WIDTHS: [(usize, usize); 8] = [
    (PAGE_BOUNDS, 48),
    (PAGE_SPHERE, 32),
    (PAGE_PARENT_SPHERE, 32),
    (PAGE_ERROR, 16),
    (PAGE_INT, 32),
    (PAGE_U32, 4),
    (GEOMETRY_U32, 28),
    (PAGE_DEPTH_LAYER, 4),
];

/// The columns of `primitives` encoded once — each one's slim record, and where its bytes start
/// in each column —: the page over any range of them is cut from these, never encoded again.
pub struct Encoded {
    columns: Vec<Column>,
    /// Where each primitive's bytes start in each column, then where the last one's end.
    starts: Vec<[usize; COLUMNS]>,
    /// Each primitive as the small JSON lists it: its counts, not its arrays.
    pub slim: Vec<Value>,
}

impl Encoded {
    /// `primitives` encoded, a bundle naming its geometry container by its rank among `files`.
    pub fn new(primitives: &[Value], files: usize) -> Result<Self> {
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
        let lengths = |columns: &[Column]| std::array::from_fn(|c| columns[c].bytes.len());
        let mut starts = Vec::with_capacity(primitives.len() + 1);
        let mut slim = Vec::with_capacity(primitives.len());
        for primitive in primitives {
            starts.push(lengths(&columns));
            let entry = MANIFEST.object(primitive, "primitive")?;
            let pages = MANIFEST.array(
                entry
                    .get("pages")
                    .ok_or_else(|| MANIFEST.bad("primitive.pages is absent"))?,
                "primitive.pages",
            )?;
            for page in pages {
                page::encode_page(page, &mut columns)?;
            }
            let count = pages.len();
            slim.push(primitive::encode_primitive(
                entry,
                count,
                &mut columns,
                files,
            )?);
        }
        starts.push(lengths(&columns));
        Ok(Encoded {
            columns,
            starts,
            slim,
        })
    }

    /// The small JSON — `top`, the slim primitives of `range` and the descriptor — and, when
    /// `written`, the columns of those primitives and of `previews` (`bytes`); else only measured,
    /// no byte laid. The descriptor carries an empty `sha256`: only the caller, holding the
    /// finished bytes, can hash them. `previews` are encoded once either way.
    pub fn page(
        &self,
        top: &Map<String, Value>,
        range: std::ops::Range<usize>,
        previews: &[TexturePreview],
        written: bool,
    ) -> Result<(Value, Vec<u8>)> {
        let laid = self.laid(range.clone(), previews)?;
        let bytes = if written {
            self.write(&laid)
        } else {
            Vec::new()
        };
        // The pixel and block columns have no fixed stride: their total lengths enter the small
        // JSON, without which a reader would not know how many bytes a column must be before
        // reading it.
        let lengths = laid.lengths;
        let preview_bytes = lengths[TEXTURE_PREVIEW_PIXELS];
        let [bc7_bytes, astc_bytes, etc2_bytes] = TEXTURE_PREVIEW_BLOCKS.map(|c| lengths[c]);
        let mut slim = top.clone();
        slim.insert("primitives".into(), Value::Array(self.slim[range].to_vec()));
        slim.insert("binary".into(),json!({"version":MANIFEST_BINARY_VERSION,"sha256":"","bytes":laid.total,
  "texturePreviews":previews.len(),
  "texturePreviewBytes":preview_bytes,"texturePreviewBc7Bytes":bc7_bytes,"texturePreviewAstcBytes":astc_bytes,
  "texturePreviewEtc2Bytes":etc2_bytes}));
        Ok((Value::Object(slim), bytes))
    }
}
