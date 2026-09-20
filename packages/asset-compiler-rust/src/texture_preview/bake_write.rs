//! The files of a baked chain: every level above the sidecar tail, once as a
//! lossless PNG and once per block format, under one folder per source
//! fingerprint. A file already there is left as-is — the fingerprint, the atlas,
//! the level and the format say its content is the right one, and rewriting it
//! would cost encoding a 2048² on every compilation of a scene that shares the
//! image. The reduction-rule version in the path keeps that promise honest.
use super::blocks::{encode_level, BlockFormat};
use super::reduce::AtlasKind;
use super::*;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};

/// Where an image's levels live in the cache, relative to `native/`: one folder
/// per reduction-rule version, then one per fingerprint, one file per atlas, per
/// level and per format. The version is in the path because a file already
/// there is never rewritten: without it, a rule that changes would keep serving
/// levels computed by the old one.
pub const TEXTURE_DIR: &str = "textures";
pub fn texture_version_dir() -> String {
    format!("{TEXTURE_DIR}/v{TEXTURE_PREVIEW_VERSION}")
}

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

/// Writes the levels above the sidecar tail — lossless, then each block format —
/// and returns how many levels exist at the end, in every format.
pub(super) fn write_levels(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    levels: &[Vec<u8>],
    (width, height): (u32, u32),
) -> Result<u32> {
    let native = o.cache.join("native");
    let first = preview_first_level(width, height);
    for (level, pixels) in levels.iter().enumerate().take(first as usize) {
        let size = preview_level_size(width, height, level as u32);
        let formats = BlockFormat::ALL.map(BlockFormat::name);
        for format in [LOSSLESS].into_iter().chain(formats) {
            let path = native.join(level_path(sha256, kind, level as u32, format));
            if path.exists() {
                continue;
            }
            let _t = perf::Timer::new(perf::Phase::TextureWrite);
            let encoded = match BlockFormat::ALL.into_iter().find(|f| f.name() == format) {
                None => png(pixels, size)?,
                Some(block) => encode_level(pixels, size.0, size.1, block),
            };
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            atomic(&path, &encoded)?;
        }
    }
    Ok(first)
}

/// The sidecar tail in a block format: every carried level compressed, end to end.
pub(super) fn block_tail(
    levels: &[Vec<u8>],
    (width, height): (u32, u32),
    format: BlockFormat,
) -> Vec<u8> {
    let first = preview_first_level(width, height);
    let mut tail = Vec::with_capacity(preview_block_bytes(width, height));
    for (level, pixels) in levels.iter().enumerate().skip(first as usize) {
        let (w, h) = preview_level_size(width, height, level as u32);
        tail.extend(encode_level(pixels, w, h, format));
    }
    tail
}
