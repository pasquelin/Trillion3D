//! A decoded image, its baked chains and its written files. This module knows
//! what it decodes and where it writes it; it does not know what a cutout is, and
//! receives the list of textures to measure.
use super::bake_write::{write_lossless, LEVEL_WRITE_FAILED};
use super::blocks::Layout;
use super::collect::AtlasTexture;
use super::gate::{cook_chain, Cooked, Gate, GateSheet};
use super::reduce::AtlasKind;
use super::*;
use crate::plugins::image::DecodedImage;

/// What an image yields once baked: one entry per (texture, atlas) that reads it.
pub(super) struct Baked {
    pub previews: Vec<TexturePreview>,
    /// Alpha shape, measured once, yielded for EVERY candidate texture that reads
    /// the image: the cutout sheet weighs by texture, and a texture without a
    /// measurement is not a candidate.
    pub shapes: Vec<(usize, crate::cutout::AlphaShape)>,
    /// One gate decision per (atlas, family) the image was cooked in.
    pub gates: Vec<Gate>,
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
    let size = (decoded.width(), decoded.height());
    let first_level = preview_first_level(size.0, size.1);
    let mut previews = Vec::with_capacity(count);
    let mut gates = Vec::new();
    let mut note = |name| {
        if !notes.contains(&name) {
            notes.push(name);
        }
    };
    // A coverage chain whose alpha never varies is the plain chain byte for byte —
    // `halve` weighs only four alphas that differ —: its readers take the plain one,
    // one chain baked instead of two identical ones.
    // Scanned only when a reader asks for coverage: an opaque image never exits early.
    let flat = readers.iter().any(|r| r.kind == AtlasKind::Coverage) && {
        let first_alpha = decoded.pixels().next().map(|p| p[3]);
        decoded.pixels().all(|p| Some(p[3]) == first_alpha)
    };
    let kind_of = |r: &AtlasTexture| if flat { r.kind.atlas() } else { r.kind };
    for kind in AtlasKind::ALL {
        let of_kind: Vec<&AtlasTexture> = readers.iter().filter(|r| kind_of(r) == kind).collect();
        if of_kind.is_empty() {
            continue;
        }
        let levels = {
            let _t = perf::Timer::new(perf::Phase::TextureBake);
            reduce::chain(&decoded, kind)
        };
        // A file that does not write — full disk, forbidden folder — does not cost
        // the tail: the entry comes out without a baked level, the engine loads the
        // source image, and the report says so.
        let baked_levels = match write_lossless(inputs.o, &sha256, kind, &levels, size) {
            Ok(written) => written,
            Err(_) => {
                note(LEVEL_WRITE_FAILED);
                0
            }
        };
        let pixels = reduce::tail(&levels, first_level);
        let sheet = GateSheet::of(&of_kind);
        let mut layouts: [Option<Layout>; 2] = [None; 2];
        let mut blocks: [Vec<u8>; 2] = [Vec::new(), Vec::new()];
        for format in &inputs.o.texture_formats {
            let (gate, cooked) =
                cook_chain(inputs.o, &sha256, kind, *format, &sheet, &levels, size);
            match cooked {
                Cooked::Kept(tail) => {
                    layouts[format.index()] = Some(sheet.layout);
                    blocks[format.index()] = tail;
                }
                Cooked::Lossless => {}
                Cooked::Failed(failure) => note(failure),
            }
            gates.push(gate);
        }
        for reader in of_kind {
            previews.push(TexturePreview {
                texture: u32::try_from(reader.texture)
                    .map_err(|_| fail("texture-out-of-bounds"))?,
                image: u32::try_from(image_index).map_err(|_| fail("image-out-of-bounds"))?,
                width: size.0,
                height: size.1,
                source: provenance,
                sha256: sha256.clone(),
                kind,
                first_level,
                baked_levels,
                pixels: pixels.clone(),
                layouts,
                blocks: blocks.clone(),
            });
        }
    }
    Ok(Baked {
        previews,
        shapes,
        gates,
        notes,
    })
}
