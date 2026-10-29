//! The sidecar entries a baked chain gives its readers, and the stored family a chain alone is kept in.
use super::super::blocks::{BlockFormat, Layout, FAMILIES};
use super::super::collect::AtlasTexture;
use super::super::reduce::AtlasKind;
use super::super::*;

/// The layouts and tail blocks of a chain kept in the stored family alone, in `layout`: `tail`
/// its blocks, or `None` for a chain none of whose files were written, kept in no family.
pub(super) fn stored_family(
    layout: Layout,
    tail: Option<Vec<u8>>,
) -> ([Option<Layout>; FAMILIES], [Vec<u8>; FAMILIES]) {
    let mut layouts = [None; FAMILIES];
    let mut blocks: [Vec<u8>; FAMILIES] = Default::default();
    if let Some(tail) = tail {
        layouts[BlockFormat::STORED.index()] = Some(layout);
        blocks[BlockFormat::STORED.index()] = tail;
    }
    (layouts, blocks)
}

/// The sidecar entries of `readers` of the image of `size`, read from `provenance`, the image
/// `image_index` of the glTF, carried from `first_level`, for the chain `key` of `kind`, its
/// `pixels` tail, the layouts it was kept in and their `blocks`, `baked_levels` of its levels
/// written as files.
pub(super) fn entries(
    readers: &[&AtlasTexture],
    (size, provenance, image_index, first_level): ((u32, u32), PreviewSource, usize, u32),
    (key, kind): (&str, AtlasKind),
    baked_levels: u32,
    (pixels, layouts, blocks): (&[u8], [Option<Layout>; FAMILIES], &[Vec<u8>; FAMILIES]),
) -> std::result::Result<Vec<TexturePreview>, &'static str> {
    readers
        .iter()
        .map(|reader| {
            Ok(TexturePreview {
                texture: u32::try_from(reader.texture).map_err(|_| "texture-out-of-bounds")?,
                image: u32::try_from(image_index).map_err(|_| "image-out-of-bounds")?,
                width: size.0,
                height: size.1,
                source: provenance,
                sha256: key.to_string(),
                kind,
                first_level,
                baked_levels,
                pixels: pixels.to_vec(),
                layouts,
                blocks: blocks.clone(),
            })
        })
        .collect()
}
