//! Fingerprints named by sidecar, read from its header. A sidecar names no object:
//! a page's geometry lies in a container the manifest's `geometryFiles` names.
use super::{
    is_digest, Result, FAMILIES, MANIFEST, MANIFEST_BINARY_HEADER_WORDS, MANIFEST_BINARY_MAGIC,
    MANIFEST_BINARY_VERSION, PREVIEW_BAKED, PREVIEW_FIRST_LEVEL, PREVIEW_KIND, PREVIEW_LAYOUTS,
    PREVIEW_WORDS, TEXTURE_PREVIEW_SHA, TEXTURE_PREVIEW_U32,
};

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
    pub layouts: [u32; FAMILIES],
}

/// Baked level files a binary sidecar names, one entry per (texture, atlas) pair.
pub fn texture_levels(bytes: &[u8]) -> Result<Vec<BakedLevels>> {
    let words = column(bytes, TEXTURE_PREVIEW_U32)?;
    let shas = column(bytes, TEXTURE_PREVIEW_SHA)?;
    let entries = words.len() / (PREVIEW_WORDS * 4);
    if words.len() != entries * PREVIEW_WORDS * 4 || shas.len() != entries * 64 {
        return Err(MANIFEST.bad("Texture preview columns disagree on the entry count"));
    }
    let word = |entry: usize, index: usize| {
        let at = (entry * PREVIEW_WORDS + index) * 4;
        // The column holds `entries` whole entries, checked above.
        crate::le::u32_at(words, at).unwrap_or(0)
    };
    (0..entries)
        .map(|entry| {
            Ok(BakedLevels {
                sha256: digest(&shas[entry * 64..entry * 64 + 64])?,
                kind: word(entry, PREVIEW_KIND),
                first: word(entry, PREVIEW_FIRST_LEVEL),
                baked: word(entry, PREVIEW_BAKED),
                layouts: std::array::from_fn(|family| word(entry, PREVIEW_LAYOUTS + family)),
            })
        })
        .collect()
}

/// One column's payload, after the header checks; empty when the file predates the column.
pub(super) fn column(bytes: &[u8], index: usize) -> Result<&[u8]> {
    let word = |at: usize| -> Result<usize> {
        let word = crate::le::u32_at(bytes, at)
            .ok_or_else(|| MANIFEST.bad("Manifest binary is truncated"))?;
        Ok(word as usize)
    };
    if word(0)? != MANIFEST_BINARY_MAGIC as usize {
        return Err(MANIFEST.bad("Manifest binary magic mismatch"));
    }
    if word(4)? != MANIFEST_BINARY_VERSION as usize {
        return Err(MANIFEST.bad("Manifest binary version mismatch"));
    }
    if index >= word(8)? {
        return Ok(&[]);
    }
    let at = (MANIFEST_BINARY_HEADER_WORDS + index * 2) * 4;
    let (offset, length) = (word(at)?, word(at + 4)?);
    bytes
        .get(offset..offset + length)
        .ok_or_else(|| MANIFEST.bad("Manifest binary column exceeds the file"))
}

/// One column entry as the digest it spells; what is not a digest names no file.
fn digest(entry: &[u8]) -> Result<String> {
    std::str::from_utf8(entry)
        .ok()
        .filter(|value| is_digest(value))
        .map(str::to_string)
        .ok_or_else(|| MANIFEST.bad("Digest column entry is not a digest"))
}
