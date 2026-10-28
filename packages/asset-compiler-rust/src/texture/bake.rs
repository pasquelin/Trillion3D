//! A decoded image, its baked chains and its written files.
mod gated;
mod half;
mod single;
pub(crate) mod write;
use super::blocks::{Layout, FAMILIES};
use super::collect::AtlasTexture;
use super::gate::Gate;
use super::reduce::AtlasKind;
use super::setting::{Compression, Route, FLOAT_DATA};
use super::*;
use crate::plugins::image::DecodedImage;
use std::borrow::Cow;

/// What a decoded byte image brings to its cook: its pixels, the levels its file stores below
/// them, the 16-bit samples the pixels were rounded from — when the file has them —, the
/// fingerprint of its bytes and where they were read from.
pub(crate) type DecodedSource<'a> = (
    &'a image::RgbaImage,
    &'a [Vec<u8>],
    Option<&'a [u16]>,
    &'a str,
    PreviewSource,
);

/// What an image yields once baked: one entry per (texture, atlas) that reads it.
#[derive(Default)]
pub(crate) struct Baked {
    pub previews: Vec<TexturePreview>,
    /// One gate decision per (atlas, family) the image was cooked in.
    pub gates: Vec<Gate>,
    pub notes: Vec<&'static str>,
}

/// Decodes an image, bakes one chain per atlas that reads it, writes the levels above the sidecar tail in every family
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
            let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureDecode);
            crate::plugins::image::decode(bytes, PREVIEW_MAX_ALLOC)?
        };
        Ok((source, provenance, sha256.to_owned()))
    });
    let (source, provenance, sha256) = read.map_err(fail)?;
    // A floating image is no byte image: its chain stays in floating point, in the half-float
    // atlas (`hdr.rs`), its own cook (`half::cook`).
    let mut unknown = false;
    let routed: Vec<(&AtlasTexture, Route)> = readers
        .iter()
        .map(|reader| {
            let setting = Compression::of(inputs.g, reader.texture).unwrap_or_else(|_| {
                unknown = true;
                Compression::Default
            });
            (reader, setting.route())
        })
        .collect();
    let mut baked = match source.image {
        DecodedImage::Rgba8(pixels) => cook_routed(
            inputs.o,
            (
                &pixels,
                &source.mips,
                source.wide.as_deref(),
                &sha256,
                provenance,
            ),
            image_index,
            &routed,
        ),
        DecodedImage::RgbaF32 {
            width,
            height,
            data,
        } => half::cook_float(
            inputs.o,
            (width, height, &data),
            (&sha256, provenance, image_index),
            &routed,
        ),
    }
    .map_err(fail)?;
    if unknown {
        baked.notes.push(super::setting::UNKNOWN);
    }
    for note in source.notes {
        if !baked.notes.contains(&note) {
            baked.notes.push(note);
        }
    }
    Ok(baked)
}

/// The chains of a decoded image `decoded` — its `stored` levels, the 16-bit samples `wide` it was
/// rounded from when the file stores them, its bytes' fingerprint `sha256`, read from
/// `provenance` — for every (texture, atlas) of `readers`, one chain per kind, each cooked in every
/// family the job asks for and its levels above the tail written under the chain's key
/// (`GateSheet::key`): the one bake of a source image and of an image the compiler draws itself
/// (the HLOD atlases, `hlod/flatten`), whose textures carry the default setting.
pub(crate) fn cook_decoded(
    o: &Options,
    source: DecodedSource<'_>,
    image_index: usize,
    readers: &[AtlasTexture],
) -> std::result::Result<Baked, &'static str> {
    let routed: Vec<_> = readers
        .iter()
        .map(|reader| (reader, Route::Gated(None)))
        .collect();
    cook_routed(o, source, image_index, &routed)
}

/// What every chain of one decoded image shares: the image, its fingerprint, where it was read
/// from, and the level it is carried from.
pub(super) struct Source<'a> {
    pub o: &'a Options,
    pub decoded: &'a image::RgbaImage,
    pub stored: &'a [Vec<u8>],
    pub wide: Option<&'a [u16]>,
    pub sha256: &'a str,
    pub provenance: PreviewSource,
    pub image_index: usize,
    pub size: (u32, u32),
    pub first_level: u32,
}

impl Source<'_> {
    /// The entire RGBA8 mip chain of the image for `kind`'s atlas (`reduce::chain`).
    pub fn chain(&self, kind: AtlasKind) -> Vec<Cow<'_, [u8]>> {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureBake);
        match self.wide {
            Some(wide) => reduce::chain_wide(self.decoded, wide, kind),
            None => reduce::chain(self.decoded, self.stored, kind),
        }
    }

    /// The sidecar entry of `texture` for the chain `key` of `kind`, its `pixels` tail, the layouts
    /// it was kept in and their `blocks`, `baked_levels` of its levels written as files.
    pub fn entry(
        &self,
        texture: usize,
        (key, kind): (&str, AtlasKind),
        baked_levels: u32,
        (pixels, layouts, blocks): (&[u8], [Option<Layout>; FAMILIES], &[Vec<u8>; FAMILIES]),
    ) -> std::result::Result<TexturePreview, &'static str> {
        Ok(TexturePreview {
            texture: u32::try_from(texture).map_err(|_| "texture-out-of-bounds")?,
            image: u32::try_from(self.image_index).map_err(|_| "image-out-of-bounds")?,
            width: self.size.0,
            height: self.size.1,
            source: self.provenance,
            sha256: key.to_string(),
            kind,
            first_level: self.first_level,
            baked_levels,
            pixels: pixels.to_vec(),
            layouts,
            blocks: blocks.clone(),
        })
    }
}

/// The chains of `readers`, each texture with the cook its setting asks for (`setting.rs`): one
/// chain per atlas and cook, the textures that share both sharing the chain.
fn cook_routed(
    o: &Options,
    (decoded, stored, wide, sha256, provenance): DecodedSource<'_>,
    image_index: usize,
    readers: &[(&AtlasTexture, Route)],
) -> std::result::Result<Baked, &'static str> {
    let size = (decoded.width(), decoded.height());
    let source = Source {
        o,
        decoded,
        stored,
        wide,
        sha256,
        provenance,
        image_index,
        size,
        first_level: preview_first_level(size.0, size.1),
    };
    let mut baked = Baked {
        previews: Vec::with_capacity(readers.len()),
        ..Baked::default()
    };
    let mut chains: BTreeMap<(AtlasKind, Route), Vec<&AtlasTexture>> = BTreeMap::new();
    for &(reader, route) in readers {
        // The half-float atlas holds colours alone: a data map asking for floating point is cooked
        // as the default.
        let route = match (route, reader.kind) {
            // One floating-point channel is a data map's; a colour map holds it as half-float RGBA.
            (Route::SingleFloat | Route::HalfSingle, AtlasKind::Color) => Route::Float,
            (Route::SingleFloat | Route::HalfSingle, _) => route,
            // The half-float atlas holds colours alone.
            (route, kind) if route.is_float() && kind != AtlasKind::Color => {
                baked.add_note(FLOAT_DATA);
                Route::Gated(None)
            }
            (route, _) => route,
        };
        chains.entry((reader.kind, route)).or_default().push(reader);
    }
    let mut floats = None;
    for ((kind, route), of_kind) in chains {
        let part = match route {
            Route::Gated(layout) => gated::cook(&source, kind, &of_kind, layout)?,
            Route::OneChannel => single::cook_one_channel(&source, kind, &of_kind)?,
            Route::Gray => single::cook_channel(&source, kind, &of_kind, Layout::Gray)?,
            Route::Displacement => {
                single::cook_channel(&source, kind, &of_kind, Layout::Displacement)?
            }
            Route::Lossless => single::cook_lossless(&source, kind, &of_kind)?,
            Route::Float | Route::FloatBlocks => {
                let data = floats.get_or_insert_with(|| half::from_bytes(decoded));
                half::cook(
                    o,
                    (size.0, size.1, data),
                    (sha256, provenance, image_index),
                    &of_kind,
                    route == Route::FloatBlocks,
                )?
            }
            Route::Float32 | Route::SingleFloat | Route::HalfSingle => {
                let data = floats.get_or_insert_with(|| half::from_bytes(decoded));
                half::cook_exact(
                    o,
                    (size.0, size.1, data),
                    (sha256, provenance, image_index),
                    (&of_kind, kind),
                    route,
                )?
            }
        };
        baked.absorb(part);
    }
    Ok(baked)
}

impl Baked {
    pub(super) fn add_note(&mut self, note: &'static str) {
        if !self.notes.contains(&note) {
            self.notes.push(note);
        }
    }
    /// Joins the chains of another route.
    fn absorb(&mut self, part: Baked) {
        self.previews.extend(part.previews);
        self.gates.extend(part.gates);
        for note in part.notes {
            self.add_note(note);
        }
    }
}
