//! A decoded image, its baked chains and its written files. This module knows
//! what it decodes and where it writes it; it does not know what a cutout is, and
//! receives the list of textures to measure.
use super::collect::AtlasTexture;
use super::reduce::AtlasKind;
use super::*;
use crate::plugins::image::DecodedImage;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};

/// Where an image's levels live in the cache, relative to `native/`: one folder
/// per reduction-rule version, then one per fingerprint, one file per atlas and
/// per level. The version is in the path because a file already there is never
/// rewritten: without it, a rule that changes would keep serving levels computed
/// by the old one.
pub const TEXTURE_DIR: &str = "textures";
/// Report note of a level file that could not be written; the entry then carries no baked level.
pub const LEVEL_WRITE_FAILED: &str = "texture-level-write-failed";
pub fn texture_version_dir() -> String {
    format!("{TEXTURE_DIR}/v{TEXTURE_PREVIEW_VERSION}")
}

/// What an image yields once baked: one entry per (texture, atlas) that reads it.
pub(super) struct Baked {
    pub previews: Vec<TexturePreview>,
    /// Alpha shape, measured once, yielded for EVERY candidate texture that reads
    /// the image: the cutout sheet weighs by texture, and a texture without a
    /// measurement is not a candidate.
    pub shapes: Vec<(usize, crate::cutout::AlphaShape)>,
    pub notes: Vec<&'static str>,
}

/// Decodes an image, measures its alpha if a texture asks, bakes one chain per
/// atlas that reads it, writes the levels above the sidecar tail. A failure holds
/// for every texture of the image, and the report counts them all.
pub(super) fn one_image(
    inputs: &PreviewInputs<'_>,
    images: &[Value],
    image_index: usize,
    readers: &[AtlasTexture],
) -> std::result::Result<Baked, (&'static str, usize)> {
    let count = readers.len();
    let fail = |reason: &'static str| (reason, count);
    let image = images.get(image_index).ok_or(fail("image-out-of-bounds"))?;
    let (bytes, provenance) = source::image_bytes(inputs, image).map_err(fail)?;
    let (decoded, mut notes) = {
        let _t = perf::Timer::new(perf::Phase::TextureDecode);
        let source = crate::plugins::image::decode(&bytes, PREVIEW_MAX_ALLOC).map_err(fail)?;
        match source.image {
            DecodedImage::Rgba8(pixels) => (pixels, source.notes),
            // A chain is RGBA8, the exact atlas format. Feeding a floating image
            // into it would need a tone map, a loss the source did not have: the
            // texture is named in the report and has no chain, never clipped.
            DecodedImage::RgbaF32 { .. } => return Err(fail("image-float-unsupported")),
        }
    };
    // Alpha measurement reads the FULL-RESOLUTION image: the width of a softened
    // edge is counted in source pixels, and a reduced level would divide it by
    // its scale. An image is measured once, for the first candidate texture that cites it.
    let candidates: Vec<usize> = readers
        .iter()
        .filter(|r| inputs.to_measure.contains(&r.texture))
        .map(|r| r.texture)
        .collect();
    let shapes = if candidates.is_empty() {
        Vec::new()
    } else {
        let _t = perf::Timer::new(perf::Phase::TextureAlpha);
        let shape = crate::cutout::measure(&decoded);
        candidates.into_iter().map(|t| (t, shape.clone())).collect()
    };
    let sha256 = hash(&bytes);
    let (width, height) = (decoded.width(), decoded.height());
    let first_level = preview_first_level(width, height);
    let mut previews = Vec::with_capacity(count);
    for kind in [AtlasKind::Color, AtlasKind::Data] {
        if !readers.iter().any(|r| r.kind == kind) {
            continue;
        }
        let levels = {
            let _t = perf::Timer::new(perf::Phase::TextureBake);
            reduce::chain(&decoded, kind)
        };
        // A file that does not write — full disk, forbidden folder — does not cost
        // the tail: the entry comes out without a baked level, the engine loads the
        // source image, and the report says so.
        let baked_levels = match write_levels(inputs.o, &sha256, kind, &levels, (width, height)) {
            Ok(written) => written,
            Err(_) => {
                if !notes.contains(&LEVEL_WRITE_FAILED) {
                    notes.push(LEVEL_WRITE_FAILED);
                }
                0
            }
        };
        let pixels = reduce::tail(&levels, first_level);
        for reader in readers.iter().filter(|r| r.kind == kind) {
            previews.push(TexturePreview {
                texture: u32::try_from(reader.texture)
                    .map_err(|_| fail("texture-out-of-bounds"))?,
                image: u32::try_from(image_index).map_err(|_| fail("image-out-of-bounds"))?,
                width,
                height,
                source: provenance,
                sha256: sha256.clone(),
                kind,
                first_level,
                baked_levels,
                pixels: pixels.clone(),
            });
        }
    }
    Ok(Baked {
        previews,
        shapes,
        notes,
    })
}

/// File of a level, relative to `native/`: the template published in the
/// manifest, filled. One truth, the same the engine applies on its side.
pub fn level_path(sha256: &str, kind: AtlasKind, level: u32) -> String {
    level_template()
        .replace("{sha}", sha256)
        .replace("{kind}", kind.name())
        .replace("{level}", &level.to_string())
}

/// Writes the levels above the sidecar tail as lossless PNG, one file per level,
/// and returns how many exist at the end. A file already there is left as-is: the
/// source-bytes fingerprint and the atlas suffice to say its content is the right
/// one, and rewriting it would cost compressing a 2048² on every compilation of a
/// scene that shares the image.
fn write_levels(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    levels: &[Vec<u8>],
    (width, height): (u32, u32),
) -> Result<u32> {
    let native = o.cache.join("native");
    let first = preview_first_level(width, height);
    for (level, pixels) in levels.iter().enumerate().take(first as usize) {
        let path = native.join(level_path(sha256, kind, level as u32));
        if path.exists() {
            continue;
        }
        let (w, h) = preview_level_size(width, height, level as u32);
        let _t = perf::Timer::new(perf::Phase::TextureWrite);
        let mut encoded = Vec::with_capacity(pixels.len() / 2);
        PngEncoder::new_with_quality(&mut encoded, CompressionType::Default, FilterType::Adaptive)
            .write_image(pixels, w, h, ExtendedColorType::Rgba8)
            .map_err(|e| CompilerError::new("TEXTURE_ENCODE_FAILED", e.to_string()))?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic(&path, &encoded)?;
    }
    Ok(first)
}

/// Stage report, which counts what it baked and what it refused.
pub(super) fn report(
    wanted: &[AtlasTexture],
    previews: &[TexturePreview],
    skipped: &BTreeMap<&'static str, usize>,
    notes: &BTreeMap<&'static str, usize>,
) -> Value {
    let pixel_bytes: usize = previews.iter().map(|entry| entry.pixels.len()).sum();
    let baked: u32 = previews.iter().map(|entry| entry.baked_levels).sum();
    json!({"version":TEXTURE_PREVIEW_VERSION,"base":PREVIEW_BASE,"maxLevels":PREVIEW_MAX_LEVELS,
        "colorTextures":wanted.iter().filter(|w| w.kind == AtlasKind::Color).count(),
        "dataTextures":wanted.iter().filter(|w| w.kind == AtlasKind::Data).count(),
        "previews":previews.len(),"pixelBytes":pixel_bytes,"bakedLevels":baked,
        "skipped":skipped,"notes":notes})
}
