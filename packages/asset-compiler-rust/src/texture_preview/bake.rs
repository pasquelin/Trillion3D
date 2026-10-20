//! A decoded image, its baked chains and its written files. This module knows
//! what it decodes and where it writes it; it does not know what a cutout is, and
//! receives the list of textures to measure.
use super::blocks::{BlockFormat, Layout, FAMILIES};
use super::collect::AtlasTexture;
use super::gate::{cook_chain, Cooked, Gate, GateSheet};
use super::reduce::AtlasKind;
use super::*;
use crate::plugins::image::DecodedImage;
use rayon::prelude::*;

/// What an image yields once baked: one entry per (texture, atlas) that reads it.
pub(crate) struct Baked {
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
/// atlas that reads it, writes the levels above the sidecar tail in every family
/// that keeps them. A failure holds for every texture of the image, and the
/// report counts them all.
pub(super) fn one_image(
    inputs: &PreviewInputs<'_>,
    images: &[Value],
    image_index: usize,
    readers: &[AtlasTexture],
) -> std::result::Result<Baked, (&'static str, usize)> {
    let count = readers.len();
    let fail = |reason: &'static str| (reason, count);
    let image = images.get(image_index).ok_or(fail("image-out-of-bounds"))?;
    // The source bytes are borrowed — a slice of the mapped binary or file —, decoded in place,
    // never copied.
    let read = source::image_bytes(inputs, image, |bytes, provenance| {
        // Bytes that read were hashed by the table, from the same read (`source::ImageShas`).
        let sha256 = inputs.image_shas.get(image_index).ok_or("image-missing")?;
        let source = {
            let _t = perf::Timer::new(perf::Phase::TextureDecode);
            crate::plugins::image::decode(bytes, PREVIEW_MAX_ALLOC)?
        };
        Ok((source, provenance, sha256.to_owned()))
    });
    let (source, provenance, sha256) = read.map_err(fail)?;
    let (decoded, notes) = match source.image {
        DecodedImage::Rgba8(pixels) => (pixels, source.notes),
        // A chain is RGBA8, the exact atlas format. Feeding a floating image
        // into it would need a tone map, a loss the source did not have: the
        // texture is named in the report and has no chain, never clipped.
        DecodedImage::RgbaF32 { .. } => return Err(fail("image-float-unsupported")),
    };
    // Alpha measurement reads the FULL-RESOLUTION image: the width of a softened
    // edge is counted in source pixels, and a reduced level would divide it by
    // its scale. The cutout step stored the shape of every candidate no answer names
    // (`cutout::apply`); an answered one, whose verdict needed none, is measured here, in the
    // decode the bake takes anyway, once for every candidate texture that cites it.
    let candidates: Vec<usize> = readers
        .iter()
        .filter(|r| inputs.to_measure.contains(&r.texture))
        .map(|r| r.texture)
        .collect();
    let shapes = if candidates.is_empty() {
        Vec::new()
    } else {
        let shape = inputs
            .measurements
            .known(&sha256)
            .cloned()
            .unwrap_or_else(|| {
                let _t = perf::Timer::new(perf::Phase::TextureAlpha);
                crate::cutout::measure(&decoded)
            });
        candidates.into_iter().map(|t| (t, shape.clone())).collect()
    };
    let mut baked = cook_decoded(
        inputs.o,
        (&decoded, &sha256, provenance),
        image_index,
        readers,
    )
    .map_err(fail)?;
    baked.shapes = shapes;
    for note in notes {
        if !baked.notes.contains(&note) {
            baked.notes.push(note);
        }
    }
    Ok(baked)
}

/// The chains of a decoded image `decoded` — its bytes' fingerprint `sha256`, read from
/// `provenance` — for every (texture, atlas) of `readers`, one chain per kind, each cooked in every
/// family the job asks for and its levels above the tail written under the chain's key
/// (`GateSheet::key`): the one bake of a source image
/// and of an image the compiler draws itself (the HLOD atlases, `compiler_world_roots/flatten`).
pub(crate) fn cook_decoded(
    o: &Options,
    (decoded, sha256, provenance): (&image::RgbaImage, &str, PreviewSource),
    image_index: usize,
    readers: &[AtlasTexture],
) -> std::result::Result<Baked, &'static str> {
    let mut notes: Vec<&'static str> = Vec::new();
    let size = (decoded.width(), decoded.height());
    let first_level = preview_first_level(size.0, size.1);
    let mut previews = Vec::with_capacity(readers.len());
    let mut gates = Vec::new();
    let mut note = |name| {
        if !notes.contains(&name) {
            notes.push(name);
        }
    };
    // A coverage chain whose alpha never varies is the plain chain byte for byte —
    // `halve` weighs only four alphas that differ, and every level's median already
    // keeps level 0's coverage —: its readers take the plain one,
    // one chain baked instead of two identical ones.
    // Scanned only when a reader asks for coverage: an opaque image never exits early.
    let flat = readers
        .iter()
        .any(|r| matches!(r.kind, AtlasKind::Coverage(_)))
        && {
            let mut alphas = decoded.pixels().map(|p| p[3]);
            let first = alphas.next();
            alphas.all(|a| Some(a) == first)
        };
    // Each texture keeps its own cutoff: textures of one image cut at two cutoffs, or
    // one of them blended, bake one chain each.
    let kind_of = |r: &AtlasTexture| if flat { r.kind.atlas() } else { r.kind };
    let mut chains: BTreeMap<AtlasKind, Vec<&AtlasTexture>> = BTreeMap::new();
    for reader in readers {
        chains.entry(kind_of(reader)).or_default().push(reader);
    }
    for (kind, of_kind) in chains {
        let levels = {
            let _t = perf::Timer::new(perf::Phase::TextureBake);
            reduce::chain(&decoded, kind)
        };
        let pixels = reduce::tail(&levels, first_level);
        let sheet = GateSheet::of(&of_kind);
        let key = sheet.key(sha256);
        let mut layouts: [Option<Layout>; FAMILIES] = [None; FAMILIES];
        let mut blocks: [Vec<u8>; FAMILIES] = Default::default();
        let cook =
            |format, files| cook_chain(o, (&key, kind), format, &sheet, &levels, size, files);
        // The stored family first, when the job cooks any — it keeps every chain it measures —: a
        // chain whose stored files did not write has no level file, in any family. The others then cook side by side, their
        // decisions gathered in the job's order.
        let (stored, others) = match o.texture_formats.split_first() {
            Some((&stored, others)) => (Some(stored), others),
            None => (None, &[][..]),
        };
        debug_assert!(stored.is_none_or(|format| format == BlockFormat::STORED));
        let first = stored.map(|format| cook(format, true));
        let files = matches!(first, Some((_, Cooked::Kept(_))));
        let others: Vec<(Gate, Cooked)> = others
            .par_iter()
            .map(|&format| cook(format, files))
            .collect();
        for (gate, cooked) in first.into_iter().chain(others) {
            match cooked {
                Cooked::Kept(tail) => {
                    layouts[gate.format.index()] = Some(sheet.layout);
                    blocks[gate.format.index()] = tail;
                }
                Cooked::Refused => {}
                Cooked::Failed(failure) => note(failure),
            }
            gates.push(gate);
        }
        // The levels above the tail are the stored family's files: one that does not write —
        // full disk, forbidden folder — does not cost the tail, the entry comes out without a
        // baked level, the engine loads the source image, and the report says so.
        let baked_levels = if layouts[BlockFormat::STORED.index()].is_some() {
            first_level
        } else {
            0
        };
        for reader in of_kind {
            previews.push(TexturePreview {
                texture: u32::try_from(reader.texture).map_err(|_| "texture-out-of-bounds")?,
                image: u32::try_from(image_index).map_err(|_| "image-out-of-bounds")?,
                width: size.0,
                height: size.1,
                source: provenance,
                sha256: key.clone(),
                image_sha256: sha256.to_owned(),
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
        shapes: Vec::new(),
        gates,
        notes,
    })
}
