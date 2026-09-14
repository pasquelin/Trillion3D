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
use crate::{CompilerError, Result};
use serde_json::{json, Map, Value};

mod format;
mod page;
mod primitive;
#[cfg(test)]
mod tests;
use format::*;

/// Version 2 adds the per-cluster coplanar depth layer column. A reader of version 1 refuses this
/// file outright rather than reading twenty of its twenty-one columns.
pub const MANIFEST_BINARY_VERSION: u32 = 2;
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
const COLUMNS: usize = 21;

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
pub fn split(manifest: &Value, templates: &Templates) -> Result<(Value, Vec<u8>)> {
    let root = object(manifest, "manifest")?;
    let primitives = array(
        root.get("primitives")
            .ok_or_else(|| bad("manifest.primitives is absent"))?,
        "manifest.primitives",
    )?;
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
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
  "pageUrl":templates.page,"geometryUrl":templates.geometry,"bundleUrl":templates.bundle}));
    Ok((Value::Object(slim), bytes))
}

/// Every object digest a binary sidecar names: the PAGE, GEOMETRY and BUNDLE sha columns, 64 ASCII
/// characters per entry. Reads the header written by `split`; a foreign or truncated file is refused.
pub fn digests(bytes: &[u8]) -> Result<Vec<String>> {
    let word = |at: usize| -> Result<usize> {
        Ok(u32::from_le_bytes(
            bytes
                .get(at..at + 4)
                .ok_or_else(|| bad("Manifest binary is truncated"))?
                .try_into()
                .expect("four bytes"),
        ) as usize)
    };
    if word(0)? != MANIFEST_BINARY_MAGIC as usize {
        return Err(bad("Manifest binary magic mismatch"));
    }
    if word(4)? != MANIFEST_BINARY_VERSION as usize {
        return Err(bad("Manifest binary version mismatch"));
    }
    let columns = word(8)?;
    let mut out = Vec::new();
    for index in [PAGE_SHA, GEOMETRY_SHA, BUNDLE_SHA] {
        if index >= columns {
            continue;
        }
        let at = (HEADER_WORDS + index * 2) * 4;
        let (offset, length) = (word(at)?, word(at + 4)?);
        let column = bytes
            .get(offset..offset + length)
            .ok_or_else(|| bad("Manifest binary column exceeds the file"))?;
        if length % 64 != 0 {
            return Err(bad("Digest column length is not a multiple of 64"));
        }
        // A page without its own geometry leaves a zero-filled slot in the geometry column.
        for entry in column.chunks(64).filter(|e| e[0] != 0) {
            out.push(
                std::str::from_utf8(entry)
                    .map_err(|_| bad("Digest column is not ASCII"))?
                    .to_string(),
            );
        }
    }
    Ok(out)
}
