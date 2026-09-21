//! Fingerprints named by sidecar, read from its header. Split from `manifest_binary.rs`
//! to respect repository line limit, without changing what they read.
use super::{
    bad, is_digest, Result, BUNDLE_SHA, GEOMETRY_SHA, HEADER_WORDS, MANIFEST_BINARY_MAGIC,
    MANIFEST_BINARY_VERSION, PAGE_SHA, PREVIEW_BAKED, PREVIEW_FIRST_LEVEL, PREVIEW_KIND,
    PREVIEW_LAYOUTS, PREVIEW_WORDS, TEXTURE_PREVIEW_SHA, TEXTURE_PREVIEW_U32,
};

/// Every object digest a binary sidecar names: the PAGE, GEOMETRY and BUNDLE sha columns, 64 ASCII
/// characters per entry. Reads the header written by `split`; a foreign or truncated file is refused.
pub fn digests(bytes: &[u8]) -> Result<Vec<String>> {
    sha_columns(bytes, &[PAGE_SHA, GEOMETRY_SHA, BUNDLE_SHA])
}

/// Every source-image digest a binary sidecar names — the directories under `textures/` its
/// baked levels live in. Same header, same refusals.
pub fn texture_digests(bytes: &[u8]) -> Result<Vec<String>> {
    sha_columns(bytes, &[TEXTURE_PREVIEW_SHA])
}

/// Baked levels a binary sidecar names for one (texture, atlas) pair, read back from
/// the words `encode_previews` wrote, so what a reuse checks on disk is exactly what
/// a reader will ask for.
pub struct BakedLevels {
    /// Source-image digest: the folder under `textures/`.
    pub sha256: String,
    /// Atlas word (`AtlasKind::word`).
    pub kind: u32,
    /// Rank of the first level the sidecar carries: a complete bake wrote every level below it.
    pub first: u32,
    /// Levels written as files, `0..baked`.
    pub baked: u32,
    /// Layout word of each family (`Layout::word`): 0 where the chain is lossless.
    pub layouts: [u32; 2],
}

/// Baked level files a binary sidecar names, one entry per (texture, atlas) pair.
pub fn texture_levels(bytes: &[u8]) -> Result<Vec<BakedLevels>> {
    let words = column(bytes, TEXTURE_PREVIEW_U32)?;
    let shas = column(bytes, TEXTURE_PREVIEW_SHA)?;
    let entries = words.len() / (PREVIEW_WORDS * 4);
    if words.len() != entries * PREVIEW_WORDS * 4 || shas.len() != entries * 64 {
        return Err(bad("Texture preview columns disagree on the entry count"));
    }
    let word = |entry: usize, index: usize| {
        let at = (entry * PREVIEW_WORDS + index) * 4;
        u32::from_le_bytes(words[at..at + 4].try_into().expect("four bytes"))
    };
    (0..entries)
        .map(|entry| {
            Ok(BakedLevels {
                sha256: digest(&shas[entry * 64..entry * 64 + 64])?,
                kind: word(entry, PREVIEW_KIND),
                first: word(entry, PREVIEW_FIRST_LEVEL),
                baked: word(entry, PREVIEW_BAKED),
                layouts: [
                    word(entry, PREVIEW_LAYOUTS),
                    word(entry, PREVIEW_LAYOUTS + 1),
                ],
            })
        })
        .collect()
}

/// One column's payload, after the header checks; empty when the file predates the column.
fn column(bytes: &[u8], index: usize) -> Result<&[u8]> {
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
    if index >= word(8)? {
        return Ok(&[]);
    }
    let at = (HEADER_WORDS + index * 2) * 4;
    let (offset, length) = (word(at)?, word(at + 4)?);
    bytes
        .get(offset..offset + length)
        .ok_or_else(|| bad("Manifest binary column exceeds the file"))
}

fn sha_columns(bytes: &[u8], wanted: &[usize]) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for &index in wanted {
        let column = column(bytes, index)?;
        if column.len() % 64 != 0 {
            return Err(bad("Digest column length is not a multiple of 64"));
        }
        // A page without its own geometry leaves a zero-filled slot in the geometry column.
        for entry in column.chunks(64).filter(|e| e[0] != 0) {
            out.push(digest(entry)?);
        }
    }
    Ok(out)
}

/// One column entry as the digest it spells; what is not a digest names no file.
fn digest(entry: &[u8]) -> Result<String> {
    std::str::from_utf8(entry)
        .ok()
        .filter(|value| is_digest(value))
        .map(str::to_string)
        .ok_or_else(|| bad("Digest column entry is not a digest"))
}
