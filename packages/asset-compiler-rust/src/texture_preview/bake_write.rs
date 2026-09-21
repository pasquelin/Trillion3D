//! The files of a baked chain: every level above the sidecar tail, once as a
//! lossless PNG and, when the gate kept a family, once in that family's blocks,
//! under one folder per source fingerprint. A file already there is left as-is
//! — the fingerprint, the atlas, the level and the format say its content is
//! the right one, and rewriting it would cost encoding a 2048² on every
//! compilation of a scene that shares the image. The reduction-rule version in
//! the path keeps that promise honest.
use super::reduce::AtlasKind;
use super::*;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use std::borrow::Cow;

/// Where an image's levels live in the cache, relative to `native/`: one folder
/// per reduction-rule version, then one per fingerprint, one file per atlas, per
/// level and per format. The version is in the path because a file already
/// there is never rewritten: without it, a rule that changes would keep serving
/// levels computed by the old one.
pub const TEXTURE_DIR: &str = "textures";
pub fn texture_version_dir() -> String {
    format!("{TEXTURE_DIR}/v{TEXTURE_PREVIEW_VERSION}")
}
/// Report note of a level file that could not be written; the entry then
/// carries no baked level, or no blocks of the family that failed.
pub const LEVEL_WRITE_FAILED: &str = "texture-level-write-failed";

/// The lossless format's name in a level path, beside the block formats'.
pub const LOSSLESS: &str = "png";

/// File of a level, relative to `native/`: the template published in the
/// manifest, filled. One truth, the same the engine applies on its side.
pub fn level_path(sha256: &str, kind: AtlasKind, level: u32, format: &str) -> String {
    level_template()
        .replace("{sha}", sha256)
        .replace("{kind}", kind.name())
        .replace("{level}", &level.to_string())
        .replace("{format}", format)
}

fn png(pixels: &[u8], (w, h): (u32, u32)) -> Result<Vec<u8>> {
    let mut encoded = Vec::with_capacity(pixels.len() / 2);
    PngEncoder::new_with_quality(&mut encoded, CompressionType::Default, FilterType::Adaptive)
        .write_image(pixels, w, h, ExtendedColorType::Rgba8)
        .map_err(|e| CompilerError::new("TEXTURE_ENCODE_FAILED", e.to_string()))?;
    Ok(encoded)
}

/// Writes the files of the levels above the sidecar tail, `encode` giving each
/// level's bytes — owned or borrowed — only when its file is missing; returns
/// how many levels exist at the end. The path is the level's, in `format`.
pub(super) fn write_levels<'a>(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    (width, height): (u32, u32),
    format: &str,
    encode: impl Fn(usize, (u32, u32)) -> Result<Cow<'a, [u8]>>,
) -> Result<u32> {
    let native = o.cache.join("native");
    let first = preview_first_level(width, height);
    for level in 0..first as usize {
        let _t = perf::Timer::new(perf::Phase::TextureWrite);
        let path = native.join(level_path(sha256, kind, level as u32, format));
        if !path.exists() {
            let bytes = encode(level, preview_level_size(width, height, level as u32))?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            atomic(&path, &bytes)?;
        }
    }
    Ok(first)
}

/// The lossless levels above the tail, PNG-encoded when missing.
pub(super) fn write_lossless(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    levels: &[Vec<u8>],
    size: (u32, u32),
) -> Result<u32> {
    write_levels(o, sha256, kind, size, LOSSLESS, |level, dims| {
        png(&levels[level], dims).map(Cow::Owned)
    })
}
